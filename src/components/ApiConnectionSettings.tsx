import { useState } from "react";
import type { Settings } from "../api";

export default function ApiConnectionSettings({ config, persist, onError }: {
  config: Settings; persist: (config: Settings) => Promise<void>; onError: (error: unknown) => void;
}) {
  const [key,setKey]=useState("");
  const [base,setBase]=useState(config.dsh.api_base || "");
  const [model,setModel]=useState(config.dsh.api_model || "");
  const manual=config.dsh.api_source==="manual";
  const save=(patch: Partial<Settings["dsh"]>,onSaved?:()=>void)=>persist({...config,dsh:{...config.dsh,...patch}}).then(onSaved).catch(onError);
  return <>
    <label>连接来源
      <select aria-label="API 连接来源" value={manual?"manual":"dsh"} onChange={e=>void save({api_source:e.target.value as "dsh"|"manual",provider:"",model:""})}>
        <option value="dsh">读取 DSH 保存的 API 连接</option><option value="manual">手动 OpenAI 兼容 API</option>
      </select>
    </label>
    {manual ? <>
      <label>Base URL<input aria-label="API Base URL" placeholder="http://127.0.0.1:7863/v1" value={base} onChange={e=>setBase(e.target.value)} onBlur={()=>void save({api_base:base})}/></label>
      <label>模型 ID<input aria-label="API 模型 ID" placeholder="填写服务提供的准确模型 ID" value={model} onChange={e=>setModel(e.target.value)} onBlur={()=>void save({api_model:model,model,provider:"manual"})}/></label>
      <label>API Key<div className="input-action"><input aria-label="API Key" type="password" autoComplete="new-password" value={key} placeholder={config.dsh.api_key_saved?"已加密保存，留空保留":"可选；仅保存在本机"} onChange={e=>setKey(e.target.value)}/><button disabled={!key} onClick={()=>void save({new_api_key:key},()=>setKey(""))}>保存 Key</button></div></label>
      {config.dsh.api_key_saved && <button onClick={()=>void save({clear_api_key:true})}>移除本机 API Key</button>}
    </> : <>
      <label>DSH Profile<input aria-label="API DSH Profile" value={config.dsh.profile} onChange={e=>void save({profile:e.target.value})}/></label>
      <p className="help">读取该 Profile 的静态模型连接和凭据，修改 DSH 连接后下次请求生效。图片由本软件直接传给所选模型；无需任务文件或 DSH 对话。</p>
    </>}
    <p className="help">API 模式复用模型连接，不执行 DSH 会话插件。需要原生 Agent 工具与插件时，切换为「完整 DSH Agent」；插件实际生效仍取决于 DSH 配置。</p>
    <label>输出 token 上限<input aria-label="输出 token 上限" type="number" min={256} max={131072} defaultValue={config.dsh.max_tokens || 8192} onBlur={e=>void save({max_tokens:Number(e.target.value)})}/></label>
    <label>API 思考强度<select aria-label="API 思考强度" value={config.dsh.api_reasoning || "off"} onChange={e=>void save({api_reasoning:e.target.value})}><option value="off">关闭 · 常规打标</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
  </>;
}
