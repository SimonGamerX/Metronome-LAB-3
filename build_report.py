#!/usr/bin/env python3
"""
Generates a 2-page report.pdf for Lab 3 matching the exact 2-page format,
fonts, colors, structure, and member presentation of the Lab 2 report.
"""

import os
import sys
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image
)
from reportlab.pdfgen import canvas


class Lab2Canvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            # In the original Lab 2 PDF, there are no header/footer lines - just pure clean pages!
            super().showPage()
        super().save()


def generate_exact_2page_report():
    out_pdf = os.path.abspath(r"..\report.pdf")
    assets_dir = os.path.abspath(r"..\assets")

    img1_path = os.path.join(assets_dir, "member1_riccardo.png")
    img2_path = os.path.join(assets_dir, "member2_nicola.png")
    img3_path = os.path.join(assets_dir, "member3_simone.png")

    # A4: 595.28 x 841.89 pt
    # Left margin 54, right margin 54 -> printable width = 487.28 pt
    doc = SimpleDocTemplate(
        out_pdf,
        pagesize=A4,
        leftMargin=54,
        rightMargin=54,
        topMargin=48,
        bottomMargin=48
    )

    styles = getSampleStyleSheet()

    # Exact font sizes & colors measured from Lab 2 PDF
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Times-Bold',
        fontSize=24,
        leading=28,
        textColor=colors.HexColor('#000000'),
        spaceAfter=8
    )

    meta_style = ParagraphStyle(
        'DocMeta',
        parent=styles['Normal'],
        fontName='Times-Roman',
        fontSize=13.5,
        leading=18,
        textColor=colors.HexColor('#000000'),
        spaceAfter=2
    )

    h1_style = ParagraphStyle(
        'DocH1',
        parent=styles['Heading1'],
        fontName='Times-Bold',
        fontSize=17,
        leading=21,
        textColor=colors.HexColor('#2c436a'),
        spaceBefore=14,
        spaceAfter=8,
        keepWithNext=True
    )

    body_style = ParagraphStyle(
        'DocBody',
        parent=styles['Normal'],
        fontName='Times-Roman',
        fontSize=12,
        leading=16.5,
        textColor=colors.HexColor('#222222'),
        spaceAfter=7
    )

    bullet_style = ParagraphStyle(
        'DocBullet',
        parent=body_style,
        leftIndent=16,
        firstLineIndent=-12,
        spaceAfter=6
    )

    table_th_style = ParagraphStyle(
        'TableTH',
        parent=styles['Normal'],
        fontName='Times-Bold',
        fontSize=13,
        leading=16,
        alignment=1, # Center
        textColor=colors.HexColor('#000000')
    )

    table_name_style = ParagraphStyle(
        'TableName',
        parent=styles['Normal'],
        fontName='Times-Roman',
        fontSize=12.5,
        leading=15,
        alignment=1, # Center
        textColor=colors.HexColor('#000000')
    )

    story = []

    # ==================== PAGE 1 ====================
    # Title & Group Metadata
    story.append(Paragraph("Lab 3 - The Metronome Thing with MQTT", title_style))
    story.append(Paragraph("Group: IOTPJ", meta_style))
    story.append(Paragraph("VSS name: iotpj", meta_style))
    story.append(Spacer(1, 10))

    # Team Members Heading
    story.append(Paragraph("Team Members", h1_style))

    # Table with Members and Photos (Row 1: Member #, Row 2: Name, Row 3: Image)
    img_w = 118
    img_h = 126
    im1 = Image(img1_path, width=img_w, height=img_h)
    im2 = Image(img2_path, width=img_w, height=img_h)
    im3 = Image(img3_path, width=img_w, height=img_h)

    members_data = [
        [Paragraph("Member 1", table_th_style),
         Paragraph("Member 2", table_th_style),
         Paragraph("Member 3", table_th_style)],

        [Paragraph("Riccardo Carini", table_name_style),
         Paragraph("Nicola Ceccarini", table_name_style),
         Paragraph("Simone Pipola", table_name_style)],

        [im1, im2, im3]
    ]

    col_w = 487.28 / 3.0 # ~162.4 pt per column
    t_members = Table(members_data, colWidths=[col_w, col_w, col_w])
    t_members.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f2f4f7')),
        ('BACKGROUND', (0, 1), (-1, 1), colors.white),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 4),
        ('TOPPADDING', (0, 0), (-1, 0), 4),
        ('BOTTOMPADDING', (0, 1), (-1, 1), 6),
        ('TOPPADDING', (0, 1), (-1, 1), 4),
        ('BOTTOMPADDING', (0, 2), (-1, 2), 6),
        ('TOPPADDING', (0, 2), (-1, 2), 4),
        ('LINEBELOW', (0, 0), (-1, 0), 0.5, colors.HexColor('#d0d7de')),
        ('LINEBELOW', (0, 1), (-1, 1), 0.5, colors.HexColor('#e2e8f0')),
    ]))
    story.append(t_members)
    story.append(Spacer(1, 8))

    # Video Demonstration Link (Exact match to Lab 1 style)
    video_link_style = ParagraphStyle(
        'DocVideoLink',
        parent=styles['Normal'],
        fontName='Times-Bold',
        fontSize=13.5,
        leading=18,
        textColor=colors.HexColor('#0b57d0'),
        spaceBefore=2,
        spaceAfter=6
    )
    story.append(Paragraph('<a href="https://youtu.be/f7nMIJXFRQo" color="#0b57d0"><u>Video Demonstration Here</u></a>', video_link_style))
    story.append(Spacer(1, 4))

    # Project Description (Exactly matching the flow of Lab 2 Page 1)
    story.append(Paragraph("Project Description", h1_style))
    p1 = (
        "For this assignment, our group successfully developed the Metronome Thing with MQTT within "
        "our iotpj Virtual Smart Space (VSS). Extending our previous Lab 2 project, we transformed the communication "
        "infrastructure from a synchronous RESTful API into an event-driven, decoupled publish/subscribe IoT system "
        "powered by the Mosquitto MQTT broker."
    )
    story.append(Paragraph(p1, body_style))

    p2 = (
        "To preserve real-time sensing and actuation precision, we maintained our hardware setup on the Raspberry Pi "
        "using two tactile pushbuttons (Mode Button on GPIO 21 and Tap Button on GPIO 26) as inputs and two LEDs "
        "(Green on GPIO 13 and Red on GPIO 16) as actuators. We adopted a hybrid architecture: a deterministic multi-threaded "
        "C++ service using wiringPi handles microsecond-accurate tempo tracking and LED control, interconnected via "
        "standard I/O IPC with an asynchronous Python client that manages MQTT communication with the broker."
    )
    story.append(Paragraph(p2, body_style))

    story.append(Paragraph("The system logic is based on two operational modes:", body_style))

    # Explicit PageBreak so Page 1 matches Lab 2's exact cutoff point!
    story.append(PageBreak())

    # ==================== PAGE 2 ====================
    # Mode Bullets (Exact match to Lab 2 Page 2 top)
    story.append(Paragraph(
        "&bull; Play Mode: The program blinks the Green LED at the specified tempo (50% duty cycle) and "
        "keeps the Red LED off. On system startup, the tempo defaults to 0 BPM (Green LED remains off). "
        "Remote MQTT commands or local button presses dynamically adjust tempo in real time.",
        bullet_style
    ))

    story.append(Paragraph(
        "&bull; Learn Mode: The program activates the Red LED upon each tap of the button to record tempo "
        "intervals in real time, requiring at least 4 taps to compute a valid BPM, while the Green LED remains off. "
        "Upon exiting Learn Mode, the system computes the average interval delta, updates the active BPM, and broadcasts "
        "the new state over MQTT.",
        bullet_style
    ))

    # MQTT Communication & Advanced Features paragraph
    p3 = (
        "The program handles sampling intervals and replaces the previous CRUD REST endpoints with a structured "
        "MQTT topic hierarchy (<code>metronome/iotpj/</code>). It publishes commands (<code>cmd/set_bpm</code>, "
        "<code>cmd/set_mode</code>, <code>cmd/reset_min</code>, <code>cmd/reset_max</code>) using Quality of Service 1 (QoS 1) "
        "to guarantee delivery. State topics (<code>state/bpm</code>, <code>state/mode</code>, <code>state/min</code>, "
        "<code>state/max</code>) use <b>retained messages</b> (<code>retain = true</code>) so new subscribers immediately "
        "receive the latest state without polling. In addition, the device configures a <b>Last Will and Testament (LWT)</b> "
        "on <code>status</code>, enabling the broker to broadcast an offline alert immediately if the device crashes or disconnects. "
        "Our remote interfaces include an interactive Web Dashboard (MQTT over WebSockets) and Python CLI tools."
    )
    story.append(Paragraph(p3, body_style))

    story.append(Spacer(1, 2))

    # Distribution of Effort (Exact style and structure of Lab 2)
    story.append(Paragraph("Distribution of Effort", h1_style))
    story.append(Paragraph(
        "The development of the Metronome Thing with MQTT was carried out through an entirely collaborative "
        "approach among all team members:",
        body_style
    ))

    story.append(Paragraph(
        "&bull; All members coordinated to configure network parameters, set up and configure the Mosquitto broker "
        "(enabling both standard TCP port 1883 and WebSocket port 9001), and design the MQTT topic space.",
        bullet_style
    ))

    story.append(Paragraph(
        "&bull; The hardware circuit on the breadboard was reused, and the team jointly implemented the hybrid architecture "
        "on the Raspberry Pi, interfacing the C++ metronome core (timing, 50ms debouncing, LED threads) with the Python MQTT bridge.",
        bullet_style
    ))

    story.append(Paragraph(
        "&bull; Writing and refining the MQTT client and remote dashboard followed a collaborative programming methodology, "
        "integrating retained messages, QoS 1 handshakes, LWT offline alerts, and testing bidirectional synchronization.",
        bullet_style
    ))

    story.append(Paragraph(
        "&bull; All members contributed equally to drafting the technical report, testing the prototype across multiple clients, "
        "and recording and editing the demonstration video.",
        bullet_style
    ))
    story.append(Spacer(1, 4))

    # Relative % of Effort (Exact match to Lab 2)
    story.append(Paragraph("Relative % of Effort", h1_style))
    story.append(Paragraph("&bull; Riccardo Carini: 33.3%", bullet_style))
    story.append(Paragraph("&bull; Nicola Ceccarini: 33.4%", bullet_style))
    story.append(Paragraph("&bull; Simone Pipola: 33.3%", bullet_style))

    # Build PDF
    doc.build(story, canvasmaker=Lab2Canvas)
    print(f"Successfully generated 2-page report at {out_pdf}")


if __name__ == "__main__":
    generate_exact_2page_report()
