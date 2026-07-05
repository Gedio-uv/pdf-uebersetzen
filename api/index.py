from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List, Dict
import fitz # PyMuPDF
import os
import json
import re
from openai import OpenAI
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.pagesizes import inch
import io

app = FastAPI()

class TranslateRequest(BaseModel):
    text: str

class GenerateRequest(BaseModel):
    clauses: List[Dict[str, str]]

@app.post("/api/extract")
async def extract_pdf(file: UploadFile = File(...)):
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Must be a PDF file")
    
    contents = await file.read()
    try:
        doc = fitz.open(stream=contents, filetype="pdf")
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid or unreadable PDF file")
        
    num_pages = len(doc)
    if num_pages == 0:
        raise HTTPException(status_code=400, detail="PDF is empty")
        
    # Validation: Check if it's mostly images
    text_length = 0
    for i in range(min(num_pages, 3)):
        text_length += len(doc[i].get_text("text").strip())
        
    if text_length < 50 and num_pages > 0:
        raise HTTPException(status_code=400, detail="This appears to be a scanned image PDF. It must contain extractable text.")
        
    text_chunks = []
    
    # Skip first and last page if document is long enough
    start_page = 1 if num_pages > 2 else 0
    end_page = num_pages - 1 if num_pages > 2 else num_pages
    
    for i in range(start_page, end_page):
        page = doc[i]
        
        # Filter out headers and footers (top 10%, bottom 10%)
        rect = page.rect
        clip_rect = fitz.Rect(rect.x0, rect.y0 + rect.height * 0.1, rect.x1, rect.y1 - rect.height * 0.1)
        text = page.get_text("text", clip=clip_rect)
        
        text = text.replace('\n', ' ').strip()
        text = " ".join(text.split()) # normalize spaces
        
        if text:
            text_chunks.append(text)
            
    full_text = " ".join(text_chunks)
    
    # Basic sentence tokenization using regex to chunk
    # We aim for chunks of roughly 1000-1500 characters
    sentences = re.split(r'(?<=[.!?]) +', full_text)
    
    final_chunks = []
    current_chunk = ""
    for sentence in sentences:
        if len(current_chunk) + len(sentence) > 1200:
            final_chunks.append(current_chunk.strip())
            current_chunk = sentence + " "
        else:
            current_chunk += sentence + " "
            
    if current_chunk.strip():
        final_chunks.append(current_chunk.strip())
        
    return {"chunks": final_chunks}

@app.post("/api/translate")
async def translate_text(req: TranslateRequest):
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not set in environment")
        
    client = OpenAI(api_key=api_key)
    
    system_prompt = """You are an expert German to English translator. 
Your task is to take a chunk of German text, segment it into short phrases or clauses (respecting commas and periods) to maintain complex grammatical context, and translate each clause to English.
You MUST output strictly in JSON format as an object containing a "clauses" array.
Example output format:
{
  "clauses": [
    {"original": "Da das Wetter heute sehr schön ist,", "translation": "Since the weather is very nice today,"},
    {"original": "werden wir in den Park gehen.", "translation": "we will go to the park."}
  ]
}"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": req.text}
            ],
            response_format={ "type": "json_object" } 
        )
        
        content = response.choices[0].message.content
        result = json.loads(content)
        return {"clauses": result.get("clauses", [])}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/generate")
async def generate_pdf(req: GenerateRequest):
    PAGE_WIDTH = 6 * inch
    PAGE_HEIGHT = 9 * inch
    
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, 
        pagesize=(PAGE_WIDTH, PAGE_HEIGHT),
        rightMargin=0.5*inch, leftMargin=0.5*inch,
        topMargin=0.5*inch, bottomMargin=0.5*inch
    )
    
    styles = getSampleStyleSheet()
    
    german_style = ParagraphStyle(
        'German',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=14,
        leading=18,
        spaceAfter=2
    )
    
    english_style = ParagraphStyle(
        'English',
        parent=styles['Normal'],
        fontName='Helvetica-Oblique', # Italic
        fontSize=10,
        leading=12,
        textColor='black', # E-ink friendly: pure black
        spaceAfter=12
    )
    
    story = []
    
    for clause in req.clauses:
        original = clause.get("original", "").strip()
        translation = clause.get("translation", "").strip()
        
        if original:
            story.append(Paragraph(original, german_style))
        if translation:
            story.append(Paragraph(translation, english_style))
            
    doc.build(story)
    buffer.seek(0)
    
    return Response(
        content=buffer.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=interlinear.pdf"}
    )
