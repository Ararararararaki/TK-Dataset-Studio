"""MCP stdio proxy: no second store, process owner, or inference server."""
import argparse, asyncio, json, os
from pathlib import Path
import httpx
from mcp.server.fastmcp import FastMCP
from mcp.types import ImageContent

parser=argparse.ArgumentParser();parser.add_argument('--data',required=True);args=parser.parse_args()
root=Path(args.data).expanduser().resolve();mcp=FastMCP('TK Dataset Studio',log_level='WARNING')

async def rpc(method,params=None):
    try:
        doc=json.loads((root/'agent-endpoint.json').read_text(encoding='utf-8'))
        if doc.get('schemaVersion')!=1 or doc.get('status')!='running':raise ValueError()
        from urllib.parse import urlsplit
        url=urlsplit(doc['url'])
        if url.scheme!='http' or url.hostname!='127.0.0.1' or not url.port or url.path!='/rpc':raise ValueError()
        token=Path(doc['tokenFile']).read_text(encoding='utf-8')
        async with httpx.AsyncClient(trust_env=False,timeout=1260,headers={'Authorization':'Bearer '+token,'X-TKDS-Client':'mcp-agent'}) as client:
            response=await client.post(doc['url'],json={'method':method,'params':params or {}});body=response.json()
        if 'error' in body:raise RuntimeError(body['error'])
        return body['result']
    except (OSError,ValueError,httpx.ConnectError):raise RuntimeError('请先打开 TK Dataset Studio，并在设置中开启 Agent 接口') from None

@mcp.tool()
async def studio_status()->dict:
    """Read datasets, presets, models and batch status from the running desktop."""
    return await rpc('bootstrap')

@mcp.tool()
async def studio_images(dataset_id:str,search:str='',status:str='all')->dict:
    """List image IDs and annotation states. The original image files remain unchanged."""
    return {'images':await rpc('images.list',locals())}

@mcp.tool()
async def studio_annotation(image_id:str)->dict:
    """Read one annotation, WD14 evidence, revision, native DSH link and errors."""
    return await rpc('images.get',{'id':image_id})

@mcp.tool()
async def studio_image(image_id:str)->list[ImageContent]:
    """View a registered dataset image as a visual attachment (max 2048 pixels)."""
    image=await rpc('agent.image',{'id':image_id})
    return [ImageContent(type='image',data=image['data'],mimeType=image['mediaType'])]

@mcp.tool()
async def studio_import(paths:list[str])->dict:
    """Import authorized existing image folders/files. Requires Agent write access."""
    return {'dataset_ids':await rpc('datasets.import',{'paths':paths})}

@mcp.tool()
async def studio_start(dataset_id:str,preset_id:str,ids:list[str]|None=None,overwrite:bool=False,instruction:str='')->dict:
    """Start a persisted batch using the desktop's settings. Existing TXT files skip by default; overwrite=True replaces them, following the desktop's backup preference. Requires write access."""
    boot=await rpc('bootstrap');preset=next((p for p in boot['presets'] if p['id']==preset_id),None)
    if not preset:raise ValueError('预设不存在')
    return await rpc('jobs.start',{'dataset_id':dataset_id,'ids':ids,'extra':instruction,'config':{**boot['settings'],'overwrite':overwrite,'preset':preset}})

@mcp.tool()
async def studio_edit(image_id:str,text:str,revision:int,format:str='manual')->dict:
    """Save a reviewed annotation with optimistic revision guard, the desktop's backup preference and audit. Requires write access. Read studio_annotation immediately before editing."""
    return await rpc('images.save',{'id':image_id,'text':text,'revision':revision,'format':format})

@mcp.tool()
async def studio_control(action:str,job_id:str='')->dict:
    """Pause after the current image, cancel owned inference, or resume an existing job. action: pause/cancel/resume. Requires write access."""
    if action not in ('pause','cancel','resume'):raise ValueError('action 应为 pause、cancel 或 resume')
    return await rpc('jobs.'+action,{'id':job_id} if action=='resume' else {})

@mcp.tool()
async def studio_audit()->dict:
    """Read the latest Agent action audit records."""
    return {'events':await rpc('agent.audit')}

@mcp.tool()
async def studio_save_preset(name:str,guidance:str,format:str='caption',pipeline:str='wd14-llm',review:bool=True,preset_id:str='')->dict:
    """Create or update a custom guidance preset. Formats: tags/caption/hybrid/moss; pipelines: wd14/wd14-llm/llm. Built-ins always become a custom copy. Requires write access."""
    return {'presets':await rpc('presets.save',{'preset':{'id':preset_id,'name':name,'description':'Agent 创建的打标预设','guidance':guidance,'format':format,'pipeline':pipeline,'review':review}})}

@mcp.tool()
async def studio_assistant(image_id:str,instruction:str)->dict:
    """Ask the native DSH assistant about a dataset image and its annotation without changing files. Requires write access because the model request may incur usage."""
    return await rpc('assistant.chat',{'id':image_id,'instruction':instruction})

if __name__=='__main__':mcp.run(transport='stdio')
