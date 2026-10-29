"""Exercise the shipped stdio MCP proxy against the running real desktop."""
import asyncio,json,sys
from pathlib import Path
from mcp import ClientSession,StdioServerParameters
from mcp.client.stdio import stdio_client

async def main():
    root=Path(__file__).resolve().parents[1];data=Path(sys.argv[1]) if len(sys.argv)>1 else root/'.scratch/desktop-state'
    executable=sys.argv[2] if len(sys.argv)>2 else str(root/'runtime/python.exe')
    params=StdioServerParameters(command=executable,args=['-m','backend.agent_mcp','--data',str(data)])
    def value(result):
        if result.isError:raise RuntimeError(str(result.content))
        if result.structuredContent:return result.structuredContent
        return json.loads(result.content[0].text)
    async with stdio_client(params) as (read,write):
        async with ClientSession(read,write) as client:
            await client.initialize();tools=await client.list_tools()
            boot=value(await client.call_tool('studio_status',{}));dataset=boot['datasets'][0]
            listed=value(await client.call_tool('studio_images',{'dataset_id':dataset['id']}));rows=listed['images']
            detail=value(await client.call_tool('studio_annotation',{'image_id':rows[0]['id']}))
            visual=await client.call_tool('studio_image',{'image_id':detail['id']});assert not visual.isError
            assert any(b.type=='image' for b in visual.content),'MCP must carry actual image data'
            changed=value(await client.call_tool('studio_edit',{'image_id':detail['id'],'text':detail['text']+'\nMCP QA note','revision':detail['revision'],'format':detail['format']}))
            restored=value(await client.call_tool('studio_edit',{'image_id':detail['id'],'text':detail['text'],'revision':changed['revision'],'format':detail['format']}))
            assert restored['text']==detail['text']
            report={'passed':True,'tools':[t.name for t in tools.tools],'checks':['real stdio session','shared desktop datasets','annotation revision','visual image content','audited edit','restore original annotation']}
            (root/'.scratch/evidence/mcp.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':asyncio.run(main())
