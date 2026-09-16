import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import List, Union
from src.config.env import settings
from src.lib.logger import logger

def send_email(to: Union[str, List[str]], subject: str, html: str, from_addr: str = "DealFlow360 <noreply@dealflow360.com>"):
    recipients = [to] if isinstance(to, str) else to
    if not recipients:
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = ", ".join(recipients)

    part = MIMEText(html, "html")
    msg.attach(part)

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=5) as server:
            server.sendmail(from_addr, recipients, msg.as_string())
        logger.info(f"Sent email '{subject}' to {recipients}")
    except Exception as e:
        logger.error(f"Failed to send email to {recipients}: {e}")

def send_invite_email(to: str, org_name: str, invite_token: str):
    link = f"http://localhost:5173/activate?token={invite_token}"
    subject = f"You've been invited to join {org_name} on DealFlow360"
    html = f"""
    <h2>Welcome to DealFlow360</h2>
    <p>You have been invited to manage <strong>{org_name}</strong>.</p>
    <p><a href="{link}">Click here to activate your account and complete onboarding</a></p>
    """
    send_email(to, subject, html)

def send_password_reset_email(to: str, reset_token: str):
    link = f"http://localhost:5173/reset-password?token={reset_token}"
    subject = "Reset your DealFlow360 password"
    html = f"""
    <h2>Password Reset Request</h2>
    <p>Click the link below to reset your password:</p>
    <p><a href="{link}">Reset Password</a></p>
    """
    send_email(to, subject, html)

def send_approval_requested_email(data: dict):
    recipients = data.get("to", [])
    q_num = data.get("quotationNumber", "")
    stage = data.get("stage", "manager").capitalize()
    subject = f"[{stage} Approval Required] Quote {q_num}"
    html = f"""
    <h3>Approval Request for Quote {q_num}</h3>
    <p>Customer: {data.get('customerName', 'N/A')}</p>
    <p>Requester: {data.get('requesterName', '')} ({data.get('requesterEmail', '')})</p>
    <p>Risk Score: {data.get('riskScore', 0)} ({data.get('riskLevel', 'low')})</p>
    """
    send_email(recipients, subject, html)

def send_approval_decision_email(data: dict):
    recipients = data.get("to", [])
    q_num = data.get("quotationNumber", "")
    decision = data.get("decision", "approved").upper()
    subject = f"[Quote {q_num}] Approval Decision: {decision}"
    html = f"""
    <h3>Quote {q_num} has been {decision}</h3>
    <p>Reason / Notes: {data.get('reason', 'N/A')}</p>
    """
    send_email(recipients, subject, html)

def send_negotiation_activity_email(data: dict):
    recipients = data.get("to", [])
    q_num = data.get("quotationNumber", "")
    act = data.get("activity", "Negotiation Activity")
    subject = f"[Quote {q_num}] Customer {act}"
    html = f"""
    <h3>Customer activity on Quote {q_num}</h3>
    <p>{data.get('negotiationNote', '')}</p>
    """
    send_email(recipients, subject, html)

def send_quote_confirmed_email(data: dict):
    recipients = data.get("to", [])
    q_num = data.get("quotationNumber", "")
    subject = f"[Quote {q_num}] Confirmed by Customer"
    html = f"""
    <h3>Quote {q_num} has been confirmed!</h3>
    <p>Customer accepted and confirmed the terms.</p>
    """
    send_email(recipients, subject, html)

def send_deal_health_alert_email(data: dict):
    recipients = data.get("to", [])
    subject = f"[Deal Health Alert] {data.get('title', 'Deal Alert')}"
    html = f"""
    <h3>{data.get('title', '')}</h3>
    <p>{data.get('detail', '')}</p>
    """
    send_email(recipients, subject, html)
