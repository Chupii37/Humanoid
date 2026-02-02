import sys
import json
from curl_cffi import requests

def main():
    try:
        # 1. Parse Arguments
        if len(sys.argv) < 5:
            print(json.dumps({"error": "Missing arguments"}))
            return

        url = sys.argv[1]
        method = sys.argv[2]
        # Handle 'null' payload safely
        raw_payload = sys.argv[3]
        payload = json.loads(raw_payload) if raw_payload and raw_payload != "null" else None
        headers = json.loads(sys.argv[4])
        
        # Handle Proxy
        proxy = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] not in ["", "null"] else None
        proxies = {"http": proxy, "https": proxy} if proxy else None

        # Handle Browser Impersonation (Randomized)
        impersonate = sys.argv[6] if len(sys.argv) > 6 else "chrome120"

        # 2. Execute Request
        response = requests.request(
            method=method,
            url=url,
            json=payload,
            headers=headers,
            proxies=proxies,
            impersonate=impersonate,
            timeout=30
        )

        # 3. Safe JSON Parsing
        # This block fixes the "Expecting value" error
        try:
            response_json = response.json()
        except:
            response_json = {} # If parsing fails (Cloudflare HTML), return empty dict

        # 4. Return Result
        print(json.dumps({
            "status_code": response.status_code,
            "json": response_json,
            "text": response.text, # This will show the Cloudflare HTML if blocked
            "headers": dict(response.headers)
        }))

    except Exception as e:
        # Catch network/script errors
        print(json.dumps({
            "status_code": 0,
            "error": str(e),
            "text": str(e)
        }))

if __name__ == "__main__":
    main()