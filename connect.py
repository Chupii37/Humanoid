import sys
import json
from curl_cffi import requests

# --- BROWSER HEADER MAPPINGS ---
# This ensures our Headers always match our TLS Fingerprint
UA_MAP = {
    "chrome120": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "chrome124": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "chrome119": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "edge101":   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.64 Safari/537.36 Edg/101.0.1210.53",
    "edge99":    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.51 Safari/537.36 Edg/99.0.1150.39",
    "safari15_5": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15"
}

def main():
    try:
        if len(sys.argv) < 2:
            print(json.dumps({"error": "Missing payload"}))
            return

        payload = json.loads(sys.argv[1])
        
        # Parse Proxy
        proxy = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] not in ["", "null"] else None
        proxies = {"http": proxy, "https": proxy} if proxy else None
        
        # Parse Impersonate Setting
        impersonate = sys.argv[3] if len(sys.argv) > 3 else "chrome120"
        
        # SELECT CORRECT USER-AGENT BASED ON IMPERSONATE
        # Fallback to Chrome 120 if the specific key isn't found
        user_agent = UA_MAP.get(impersonate, UA_MAP["chrome120"])

        url = "https://app.humanoidnetwork.org/api/auth/authenticate"
        
        headers = {
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "Origin": "https://app.humanoidnetwork.org",
            "Referer": "https://app.humanoidnetwork.org/",
            "User-Agent": user_agent  # <--- DYNAMIC USER AGENT
        }

        response = requests.post(
            url,
            json=payload,
            headers=headers,
            proxies=proxies,
            impersonate=impersonate,
            timeout=30
        )

        try:
            response_json = response.json()
        except:
            response_json = {}

        print(json.dumps({
            "status_code": response.status_code,
            "json": response_json,
            "text": response.text,
            "headers": dict(response.headers)
        }))

    except Exception as e:
        print(json.dumps({
            "status_code": 0,
            "error": str(e),
            "text": str(e)
        }))

if __name__ == "__main__":
    main()