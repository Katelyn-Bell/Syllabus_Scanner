import os
import google.generativeai as genai
from pypdf import PdfReader
from dotenv import load_dotenv

# 1. Load the secrets from .env
load_dotenv()
API_KEY = os.getenv("GEMINI_API_KEY")

# 2. Setup Gemini
genai.configure(api_key=API_KEY)
model = genai.GenerativeModel('gemini-1.5-flash')

def extract_text_from_pdf(pdf_path):
    reader = PdfReader(pdf_path)
    text = ""
    for page in reader.pages:
        text += page.extract_text() + "\n"
    return text

# 3. Running the logic
if __name__ == "__main__":
    # Make sure you have a file named 'test.pdf' in your folder!
    syllabus_text = extract_text_from_pdf("test.pdf")

    # This prompt tells Gemini to return "Structured Data" (JSON)
    # This is crucial so your React website can read it easily later.
    prompt = f"""
    Extract the assignments and exam dates from the following syllabus.
    Return the data ONLY as a JSON array of objects. 
    Each object should have: "title", "date", and "type" (e.g., Assignment, Exam, Quiz).

    Syllabus Text:
    {syllabus_text}
    """

    response = model.generate_content(prompt)
    
    print("--- JSON DATA FROM AI ---")
    print(response.text)