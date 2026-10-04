# Alibaba 1688 Scraper

A Windows desktop app that saves product media from **Alibaba.com** and **1688.com**: full-size images, videos, description images and product details. It can optionally sharpen blurry images with an AI upscaler that runs on your own graphics card.

Paste one link or a hundred, press **Start scraping**, and every product lands in its own tidy folder.

> **Status:** version 1.0, tested on Windows 11. This is an early release, so expect rough edges.

---

## Download

Get the installer from the [**Releases**](../../releases/latest) page:

1. Download `Alibaba-1688-Scraper-Setup-<version>.exe`.
2. Run it and follow the steps. No administrator rights are needed.
3. Windows may show **"Windows protected your PC"** because the installer is not code-signed. Click **More info**, then **Run anyway**.

**Requirements:** Windows 10 or 11 (64-bit). AI sharpening additionally needs a graphics card with Vulkan support (almost every recent NVIDIA, AMD or Intel GPU). Scraping itself works without one.

---

## What it does

- **Full-size images.** Gallery, variant and description images, saved at the largest size the site offers instead of the small thumbnails you see on the page.
- **Videos.** Product videos saved as normal `.mp4` files.
- **Product details.** Title, price tiers, minimum order, supplier and specifications, saved next to the images and in a CSV for the whole batch.
- **Batches.** Paste a list of links, drop in a `.txt` file or drag links in from your browser. Mixed Alibaba and 1688 lists are fine.
- **AI sharpening (optional).** Creates a larger, cleaner copy of each image and keeps the original untouched. Runs locally, so nothing is uploaded.
- **Captcha-friendly.** If a site asks you to prove you are human, the app pauses, tells you, and carries on once you have solved it.
- **Picks up where you left off.** Close the app mid-batch and it offers to continue next time.
- **Light and dark themes** that follow your Windows setting.

---

## Quick start

1. **Log in (recommended for 1688).** Use the *Alibaba* and *1688* buttons at the top right. A separate browser window opens where you sign in as you normally would. Your login stays on your computer. Alibaba works without an account.
2. **Paste product links.** Use the full product-page address. The app shows how many links it found and ignores duplicates and pages that are not products.
3. **Press Start scraping.** Watch progress per product. Click any product to preview its images, see its details and open its folder.

Your files are saved to `Documents\Alibaba-Scraper` by default. You can change this in **Settings**.

### What you get

```
Alibaba-Scraper/
  alibaba/ or 1688/
    <product id>_<title>/
      images/            main gallery
      variants/          colour and style pictures
      description/       images from the description
      videos/            product video
      images_upscaled/   sharpened copies (if enabled)
      product.json       details for this product
  products_<date>.csv    one row per product in the batch
```

### Settings

| Setting | What it does |
| --- | --- |
| Save location | Where product folders are created |
| What to download | Turn variants, description images and videos on or off |
| Make images sharper | AI upscaling, with a size threshold so large images are skipped |
| Speed | *Careful*, *Balanced* or *Fast*. Slower is gentler on the sites and triggers fewer captchas |
| Accounts | Sign out of both sites and clear the saved login |

---

## How it works (the short version)

The app contains its own browser. Each product page is opened the same way you would open it yourself, using the login you provided, and the information the page has already loaded is collected. Image links are then upgraded to their original versions and downloaded in the background, one product at a time with short pauses in between. Optional upscaling runs on your GPU after the download.

Everything happens on your computer. There is no server, no account with this project and no telemetry.

The detailed per-site logic is intentionally not documented here.

---

## Build from source

Requires Windows and a current LTS release of [Node.js](https://nodejs.org/) (developed on Node 24).

```powershell
git clone https://github.com/Nishmam12/Alibaba-1688-Image-and-Video-Downloader.git
cd Alibaba-1688-Image-and-Video-Downloader
npm install
npm run get-upscaler   # downloads the Real-ESRGAN binaries (optional, for AI sharpening)
npm start              # run the app
npm test               # run the unit tests
npm run dist           # build the Windows installer into ./release
```

### Project layout

```
main/        app logic: window, queue, browser session, downloads, upscaler, export
renderer/    the user interface (HTML, CSS, JavaScript)
scripts/     helper scripts (upscaler download, icon generation)
test/        unit tests
build/       app icon
```

---

## Privacy and security

- Logins are stored only in the app's local data folder on your PC. **Sign out** in Settings removes them.
- The app only opens Alibaba and 1688 pages and downloads from their image and video servers. Those pages load their usual scripts, as they would in any browser. The only other connection is to GitHub, once, if you run `npm run get-upscaler`.
- The interface runs in a locked-down window with no direct access to your system, and only the product files it saved can be shown in the preview.

---

## Responsible use

This tool is for sourcing research and for saving media you have a right to use. Please:

- follow the terms of service of Alibaba and 1688, which restrict automated access;
- respect suppliers' copyright. Product photos and videos belong to the suppliers, so ask for permission before reusing them in your own listings;
- keep the speed setting gentle and do not run huge unattended batches.

This project is not affiliated with, endorsed by or connected to Alibaba Group.

---

## Credits

AI sharpening uses the Windows build of [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) (ncnn Vulkan) by Xintao Wang et al., downloaded from its official release. See that project for its license terms. Built with [Electron](https://www.electronjs.org/).

---

## License

Released under the [PolyForm Noncommercial License 1.0.0](LICENSE).

In plain words: you can read the code, run it, modify it and share it for **noncommercial** purposes, including personal use, research, study and hobby projects. You may **not** use it, or anything built from it, to make money or in a business without the author's written permission. The [LICENSE](LICENSE) file is the legally binding text. For commercial use, open an issue on this repository to ask.
