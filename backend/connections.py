"""Read DSH's static, public connection configuration, without booting a Host.

This is a connection reuse adapter, not Agent/plugin execution. No JavaScript
YAML tags are evaluated; credentials never enter the renderer or job snapshot.
"""
import os, re
from pathlib import Path
from urllib.parse import urlsplit
import yaml
from dotenv import dotenv_values

class StaticLoader(yaml.SafeLoader):pass
StaticLoader.add_multi_constructor('tag:yaml.org,2002:js',lambda loader,suffix,node:None)
StaticLoader.add_multi_constructor('!',lambda loader,suffix,node:None)

def document(path, default=None):
    if not path.exists():return default
    try:return yaml.load(path.read_text(encoding='utf-8-sig'),Loader=StaticLoader)
    except (OSError,yaml.YAMLError):raise ValueError(f'DSH 静态配置无法读取：{path.name}；不会执行动态配置或输出密钥') from None

def endpoint(value):
    value=str(value).strip().rstrip('/')
    parsed=urlsplit(value)
    if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('API Base URL 需为不含凭据、查询或片段的 HTTP/HTTPS 地址')
    return value

def is_loopback(url):return urlsplit(url).hostname in ('localhost','127.0.0.1','::1')

class Connections:
    def __init__(self,root,settings,home=None):
        self.root=Path(root);self.settings=settings;self.home=Path(home) if home else Path(os.environ.get('DSH_HOME',str(Path.home()/'.dsh')))

    def snapshot(self,config):
        profile=config.get('profile','web')
        if not re.fullmatch(r'[A-Za-z0-9_-]+',profile):raise ValueError('DSH Profile 名称无效')
        path=self.home/'profiles'/profile/'cordis.patch.yml'
        rows=document(path,[])
        if not isinstance(rows,list):raise ValueError('DSH 静态连接配置应为条目列表')
        known={r.get('id'):r.get('config',{}) for r in rows if isinstance(r,dict) and not r.get('disabled') and isinstance(r.get('config'),dict)}
        providers={}
        wb=known.get('llm-workbuddy')
        if wb and wb.get('baseURL'):providers['workbuddy']=wb
        for name,value in known.get('llm-pi-ai',{}).get('providers',{}).items():
            if isinstance(value,dict) and value.get('baseURL') and value.get('api') in ('openai-completions','openai-chat-completions'):
                providers[name]=value
        return known.get('agent-default-model',{}),providers

    def credential(self,reference):
        if not reference or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',reference):raise ValueError('DSH 连接缺少静态 apiKeyEnv 引用；请在 DSH 模型设置保存连接')
        # Official credentials-local v1 precedence: managed store > inherited
        # environment > invocation .env > DSH home .env. Never rewrite DSH files.
        doc=document(self.home/'.credentials.yaml',{}) or {}
        if doc and doc.get('version')!=1:raise ValueError('DSH 凭据格式需为 version: 1；请先在 DSH 更新保存')
        for value in ((doc.get('refs') or {}).get(reference),os.environ.get(reference),dotenv_values(Path.cwd()/'.env').get(reference),dotenv_values(self.home/'.env').get(reference)):
            if isinstance(value,str) and value.strip():return value.strip()
        raise ValueError(f'DSH 连接凭据 {reference} 未配置；请在 DSH 保存 Key')

    def save_key(self,value,clear=False):
        path=self.root/'api-key.dpapi'
        if clear:path.unlink(missing_ok=True)
        elif value:
            import win32crypt
            data=win32crypt.CryptProtectData(value.encode(),'TK Dataset Studio API key',None,None,None,0)
            temp=path.with_suffix('.tmp');temp.write_bytes(data);temp.replace(path)

    def manual_key(self):
        path=self.root/'api-key.dpapi'
        if not path.exists():return ''
        try:
            import win32crypt
            return win32crypt.CryptUnprotectData(path.read_bytes(),None,None,None,0)[1].decode()
        except Exception:raise ValueError('本机 API Key 无法解密，请重新保存') from None

    def resolve(self,config=None):
        config=config or self.settings()
        if config.get('api_source')=='manual':
            model=config.get('model') or config.get('api_model','')
            if not model:raise ValueError('请填写 API 模型 ID')
            return {'provider':'manual','model':model,'base_url':endpoint(config.get('api_base','')),'key':self.manual_key(),'models':[], 'thinking':None}
        default,providers=self.snapshot(config)
        provider=config.get('provider') or default.get('provider')
        selected=providers.get(provider)
        if not selected:raise ValueError('未找到所选 DSH 提供商的静态 OpenAI 兼容连接；请检测连接或选择手动 API')
        model=config.get('model') or (default.get('model') if provider==default.get('provider') else None)
        if not model:raise ValueError('请选择看图模型')
        models=selected.get('models',[])
        if models and model not in {m.get('id') for m in models}:raise ValueError('所选模型已不在 DSH 连接中，请重新选择')
        return {'provider':provider,'model':model,'base_url':endpoint(selected.get('baseURL','')),'key':self.credential(selected.get('apiKeyEnv')),'models':models,'thinking':selected.get('thinking'),'reasoningEffort':selected.get('reasoningEffort')}

    async def catalog(self):
        import httpx
        config=self.settings();connection=self.resolve(config)
        proxy=None if is_loopback(connection['base_url']) else config.get('proxy') or 'http://127.0.0.1:7890'
        headers={'Authorization':'Bearer '+connection['key']} if connection['key'] else {}
        try:
            async with httpx.AsyncClient(proxy=proxy,trust_env=False,timeout=15) as client:
                response=await client.get(connection['base_url']+'/models',headers=headers)
                if response.status_code in (401,403):raise ValueError(f'API 认证失败（HTTP {response.status_code}）；请检查连接凭据')
                response.raise_for_status();remote=response.json().get('data',[])
        except ValueError:raise
        except Exception:raise ValueError('API 模型接口不可达；请检查 DSH 网关/服务是否启动，外网连接需 Clash 代理') from None
        if config.get('api_source')=='manual':
            groups=[{'id':'manual','label':'手动 API','models':[{'id':m['id']} for m in remote if isinstance(m,dict) and isinstance(m.get('id'),str)]}]
        else:
            _,providers=self.snapshot(config)
            groups=[{'id':name,'label':name,'models':[{'id':m['id'],'name':m.get('name',m['id'])} for m in p.get('models',[]) if isinstance(m,dict) and m.get('id')]} for name,p in providers.items()]
        # Preserve explicitly configured IDs when /models returns an empty list.
        if not any(m['id']==connection['model'] for g in groups for m in g['models']):
            groups.append({'id':connection['provider'],'models':[{'id':connection['model']}]})
        return {'connected':True,'transport':'api','host_url':connection['base_url'],'workspaces':[],'plugins':[],
                'capabilities':{'models':{'default':{'provider':connection['provider'],'model':connection['model']},'groups':groups}}}
