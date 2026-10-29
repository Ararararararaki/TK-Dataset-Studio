"""One final-output contract shared by API and optional Agent execution."""
import re

def check_response(text):
    if not isinstance(text,str) or not text.strip():
        raise ValueError('模型没有返回可保存的正文（思考过程不计为标注）')
    # Check the leading reply, including a short Agent preamble. Never save a
    # refusal as a caption, and never ask a repair request to override one.
    lead=text[:2400]
    refusal=r"^\s*(?:(?:sorry|i['’]m sorry)[,.!]?\s*)?(?:(?:i\s+(?:cannot|can['’]t|will\s+not|won['’]t)|i['’]m\s+unable\s+to)\s+(?:produce|provide|create|generate|assist|help|comply|fulfil|fulfill|complete|process|describe|annotate)\b|refused\b|(?:无法|不能|不予|拒绝)(?:为您|为你|协助|提供|生成|完成|处理|描述|标注))"
    if re.search(refusal,lead,re.I|re.M):
        raise ValueError('模型拒绝了本次请求；未保存标注，不会自动重试此回复')
    return text.strip()

def annotation_only(text):
    text=check_response(text)
    if re.match(r"(?:I(?:['’]ll| will| am going to)|I['’]m (?:going|reading|checking)|Let me|Here (?:is|are)|I (?:read|have read|checked)|我(?:先|将|会)|以下是|这是(?:您|你)要的)",text,re.I):
        raise ValueError('模型返回了过程说明；没有可直接保存的最终标注')
    return text
