# GeoFS Extra Runways Addon

A professional extension for **GeoFS** that restores missing airport runways, complete with functional ILS, PAPI lights, and high-quality runway overlays.

---

## Features

* **Infrastructure Restoration:** Adds critical runways missing from the default GeoFS database.
* **Precision Landing:** Full support for **ILS (Instrument Landing System)** and **PAPI (Precision Approach Path Indicator)**.
* **Visual Fidelity:** Real-time runway overlays for improved ground visibility and realism.
* **Seamless Integration:** Fully compatible with GeoFS navigation systems and map markers.
* **Custom UI:** Includes a minimalist black-and-white notification system for status updates.

---

## Installation & Usage

### Method 1: Tampermonkey (Recommended)
1.  Install the [Tampermonkey](https://www.tampermonkey.net/) extension.
2.  Create a new script and paste the content of `main.js`.
3.  Save and ensure the script is enabled.

### Method 2: Browser Console
1.  Copy the code from `main.js`.
2.  Open GeoFS, press `F12` to open the console.
3.  Paste the code and hit `Enter`.

### Triggering the Load
To ensure the new runways appear, you must refresh the terrain data:
1.  Teleport to an airport far away from your current location.
2.  Change back to your target airport.
3.  **Upon success, you will see the loading status in the console:**

<img width="1036" height="1069" alt="Loading Success" src="https://github.com/user-attachments/assets/d84cb8ba-973b-440d-b65b-ee90d758eff3" />

---

## Visual Comparison (ZJHK RWY10)

### Before
<img width="1311" height="1323" alt="Before" src="https://github.com/user-attachments/assets/1e9401a7-3cc6-43ea-81a9-5639841551c7" />

### After
<img width="1688" height="1471" alt="After" src="https://github.com/user-attachments/assets/d59bf574-447d-468d-a6a4-beb3d82e2006" />

---

## Supported Runways Database

| ICAO | Airport Name | Added Runways | Note |
| :--- | :--- | :--- | :--- |
| **VHHH** | Hong Kong Intl | 07L/25R | Corrects 07C/25C mislabeling |
| **ZGSZ** | Shenzhen Bao'an | 16L/34R | |
| **ZGGG** | Guangzhou Baiyun | 02R/20L, 01L/19R, 03/21 | |
| **ZUCK** | Chongqing Jiangbei | 03L/21R, 03R/21L | |
| **ZJHK** | Haikou Meilan | 10/28 | |
| **ZPPP** | Kunming Changshui | 04R/22L | |
| **ZUTF** | Chengdu Tianfu | 02/20, 01/19, 11/29 | |
| **SPIM** | Lima (SPJC) | 16R/34L | Listed as SPIM in-game |
| **ZHCC** | Zhengzhou Xinzheng| 12L/30R | |
| **ZHHH** | Wuhan Tianhe | 05L/23R, 05R/23L | |
| **ZSQD** | Qingdao Jiaodong | 35/17, 34/16 | |
| **ZSHZ** | Hangzhou Xiaoshan | 18/36 | |
| **ZGHA** | Changsha Huanghua | 36R/18L | |

---

## 📞 Support & Contribution

If you have runway data to contribute or encounter any issues, please contact the developer:

* **Discord:** `CES2731`
* **Email:** `1830524785@qq.com`

---
