from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "UI-Mockups.pdf"
PAGE_W, PAGE_H = landscape(A4)

FRAMES = [
    ("D-00 | ACCOUNT ACCESS | UC-01", "D-00-Account-Access.png"),
    ("D-01 | VEHICLE PROFILE & PREFERENCES | UC-02", "D-01-Vehicle-Profile.png"),
    ("D-02 | PLAN A CHARGING STOP | UC-03", "D-02-Plan-Charging-Stop.png"),
    ("D-03 | CHARGING RECOMMENDATIONS | UC-03, UC-04, UC-06", "D-03-Recommendations.png"),
    ("D-04 | COMPARE & RECONFIGURE | UC-04, UC-05", "D-04-Compare-Reconfigure.png"),
    ("D-05 | REPORT A CHARGER ISSUE | UC-07", "D-05-Report-Issue.png"),
    ("D-06 | MODERATOR REPORT REVIEW | UC-08", "D-06-Moderator-Review.png"),
    ("M-01 | PLAN A CHARGING STOP | MOBILE RESPONSIVE COMPANION", "M-01-Plan-Mobile.png"),
    ("M-02 | CHARGING RECOMMENDATIONS | MOBILE RESPONSIVE COMPANION", "M-02-Recommendations-Mobile.png"),
]


def main() -> None:
    pdf = canvas.Canvas(str(OUTPUT), pagesize=(PAGE_W, PAGE_H))
    pdf.setTitle("PlugPlan SG - Lab 1 UI Mockups")
    pdf.setAuthor("Team SCE3-04")

    for title, filename in FRAMES:
        image_path = ROOT / "ui-mockups" / filename
        image = ImageReader(str(image_path))
        image_w, image_h = image.getSize()

        pdf.setFillColor(HexColor("#334155"))
        pdf.setFont("Helvetica-Bold", 10.5)
        pdf.drawString(18, PAGE_H - 20, title)

        max_w = PAGE_W - 42
        max_h = PAGE_H - 54
        scale = min(max_w / image_w, max_h / image_h)
        draw_w = image_w * scale
        draw_h = image_h * scale
        x = (PAGE_W - draw_w) / 2
        y = (PAGE_H - draw_h) / 2 - 4
        pdf.drawImage(image, x, y, width=draw_w, height=draw_h, preserveAspectRatio=True, mask="auto")
        pdf.showPage()

    pdf.save()
    print(OUTPUT)


if __name__ == "__main__":
    main()
