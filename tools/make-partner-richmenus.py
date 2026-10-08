"""產生老師／診所圖文選單圖片 public/richmenu-teacher.jpg、public/richmenu-clinic.jpg。

版面 2500x843、橫排三格，要和 src/partners/richmenu.js 的 areas 對齊。
改了文字或配色就重跑這支，再開 /setup-partner-menus?secret=... 重建選單。
需要 Pillow 與 Windows 內建的微軟正黑體(msjhbd.ttc)。
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 2500, 843
FONT = "C:/Windows/Fonts/msjhbd.ttc"
OUT = Path(__file__).resolve().parent.parent / "public"

MENUS = {
    "richmenu-teacher.jpg": [
        ("我的課表", "未來 30 天場次", (46, 125, 50)),
        ("報名人數", "各場報名狀況", (21, 101, 192)),
        ("指令說明", "可用功能一覽", (97, 97, 97)),
    ],
    "richmenu-clinic.jpg": [
        ("診所統計", "開立與執行數", (0, 121, 107)),
        ("禮券進度", "四項完成領券狀況", (230, 81, 0)),
        ("指令說明", "可用功能一覽", (97, 97, 97)),
    ],
}


def centered(draw, cx, y, text, font, fill):
    w = draw.textlength(text, font=font)
    draw.text((cx - w / 2, y), text, font=font, fill=fill)


def main():
    title = ImageFont.truetype(FONT, 150)
    sub = ImageFont.truetype(FONT, 72)
    col = W // 3
    for name, cells in MENUS.items():
        img = Image.new("RGB", (W, H), "white")
        d = ImageDraw.Draw(img)
        for i, (label, hint, color) in enumerate(cells):
            x0 = i * col
            x1 = W if i == 2 else x0 + col
            d.rectangle([x0 + 6, 6, x1 - 6, H - 6], fill=color)
            cx = (x0 + x1) / 2
            centered(d, cx, H / 2 - 170, label, title, "white")
            centered(d, cx, H / 2 + 60, hint, sub, (255, 255, 255))
        out = OUT / name
        img.save(out, "JPEG", quality=88)
        print(out, round(out.stat().st_size / 1024), "KB")


if __name__ == "__main__":
    main()
