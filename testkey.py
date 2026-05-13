import urllib.request
import json
import urllib.error

url = 'https://api.openai.com/v1/chat/completions'
headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer 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'
}
data = {
    'model': 'gpt-4o-mini',
    'messages': [{'role': 'user', 'content': 'hi'}]
}

req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers=headers)

try:
    with urllib.request.urlopen(req) as response:
        result = json.loads(response.read().decode('utf-8'))
        print("Success:", result)
except urllib.error.URLError as e:
    print("Error:", e.read() if hasattr(e, 'read') else e.reason)
