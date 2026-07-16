import json
import os
from curl_cffi import requests

def scrape_portfolios():
    print("Initiating custom Bionluk API Scraper for user: rey7iar...")
    
    speed_init_url = "https://bionluk.com/api/users/speed_init/"
    portfolio_url = "https://bionluk.com/api/seller/portfolio_get_all/"
    
    headers = {
        "sec-ch-ua-platform": '"Windows"',
        "super-key": "1e291318-f4b6-4a65-8323-a1823dbd7564",
        "referer": "https://bionluk.com/portfolyo/rey7iar",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "accept": "application/json, text/plain, */*",
    }
    
    try:
        # Step 1: Initialize session to get a dynamic super-token
        print("Fetching dynamic authentication token from speed_init...")
        r_init = requests.post(speed_init_url, headers=headers, impersonate="chrome")
        if r_init.status_code != 200:
            raise Exception(f"Failed to load speed_init, status code {r_init.status_code}")
            
        init_data = r_init.json()
        token = init_data.get("token")
        if not token:
            raise Exception("No authentication token found in speed_init response")
        print(f"Dynamic token retrieved: {token}")
        
        # Step 2: Query the portfolios list using the retrieved token
        print("Requesting portfolios list from Bionluk API...")
        headers["super-token"] = token
        payload = {
            "username": "rey7iar",
            "status": "1",
            "limit": "16",
            "offset": "0",
            "tag": ""
        }
        
        r_port = requests.post(portfolio_url, data=payload, headers=headers, impersonate="chrome")
        if r_port.status_code != 200:
            raise Exception(f"Failed to fetch portfolios list, status code {r_port.status_code}")
            
        port_data = r_port.json()
        if not port_data.get("success"):
            raise Exception(f"API returned error: {port_data.get('message')}")
            
        raw_portfolios = port_data.get("data", {}).get("portfolios", [])
        print(f"Successfully retrieved {len(raw_portfolios)} portfolios from Bionluk.")
        
        # Step 3: Process the portfolios and map to the site structure
        processed_portfolios = []
        for idx, p in enumerate(raw_portfolios):
            uuid = p.get("uuid")
            title = p.get("name", "")
            desc = p.get("description", "").strip()
            image_url = p.get("image_url_small") or p.get("image_url")
            sub_category = p.get("category_sub_name", "Web Yazılım")
            
            # Map categories to Turkish and English
            category_tr = "Web Tasarım"
            category_en = "Web Design"
            if "video" in title.lower() or "video" in desc.lower() or "animasyon" in title.lower():
                category_tr = "Video Kurgu"
                category_en = "Video Editing"
            elif sub_category != "Web Yazılım":
                category_tr = sub_category
                category_en = sub_category
            
            # We keep the high-fidelity translations for known projects,
            # and fall back to clean generic mappings for any new projects.
            if "medikal" in title.lower():
                title_tr = "Medikal Web Sitesi Tasarımı"
                title_en = "Medical Website Design"
                desc_tr = "Almed Medikal için hazırlanan modern, mobil uyumlu ve kurumsal web tasarım çalışması."
                desc_en = "Modern, responsive, and corporate web design study prepared for Almed Medical."
            elif "entertainment" in title.lower() or "oyun abisi" in title.lower():
                title_tr = "Entertainment Şirketi Web Sitesi Tasarımı"
                title_en = "Entertainment Company Website Design"
                desc_tr = "Oyun Abisi markası için tasarlanan kurumsal kimliğe uygun, sade ve şık web tasarım çalışması."
                desc_en = "Clean, custom website design styled for the corporate identity of Oyun Abisi."
            else:
                title_tr = title
                title_en = title
                desc_tr = desc
                desc_en = desc
                
            processed_portfolios.append({
                "id": idx + 1,
                "title_tr": title_tr,
                "title_en": title_en,
                "desc_tr": desc_tr,
                "desc_en": desc_en,
                "image": image_url,
                "category_tr": category_tr,
                "category_en": category_en,
                "link": f"https://bionluk.com/freelancer-vitrin/{uuid}"
            })
            
        # Write output JSON to assets folder
        output_dir = "assets"
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)
            
        output_path = os.path.join(output_dir, "portfolios.json")
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(processed_portfolios, f, ensure_ascii=False, indent=2)
            
        print(f"Scraper completed successfully. Portfolio data saved to {output_path}")
        
    except Exception as e:
        print("Scraper error:", e)

if __name__ == "__main__":
    scrape_portfolios()

