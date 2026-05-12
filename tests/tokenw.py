import base64
import io
import time
from openai import OpenAI
from PIL import Image

# --- CONFIGURAZIONE ---
client = OpenAI(
    base_url="https://api-gb10.elettra.ai/v1", 
    api_key="gln_qrKN0_OxXKIFK5GRvju6VatfXSOvr-Slx67qFpDFoM6q8TbgiOiBKWESn2n5-le1"
)
MODEL_NAME = "Galene/LLM"
TARGET_TOKENS = 200000

def create_dummy_image(width, height, color):
    img = Image.new('RGB', (width, height), color=color)
    buffered = io.BytesIO()
    img.save(buffered, format="JPEG")
    return base64.b64encode(buffered.getvalue()).decode('utf-8')

# 1. Generazione testo massivo (200k token)
# Usiamo una stringa leggermente variabile per simulare dati reali
print(f"--- Generazione di {TARGET_TOKENS} token di testo ---")
chunk = "Il test del contesto sta procedendo correttamente. " # ~10 token
long_text = chunk * (TARGET_TOKENS // 10)

# 2. Generazione 4 immagini 800x600
print("--- Generazione 4 immagini 800x600 ---")
colors = ['purple', 'orange', 'cyan', 'magenta']
image_data = [create_dummy_image(800, 600, c) for c in colors]

# 3. Preparazione dei messaggi
content = [
    {
        "type": "text", 
        "text": f"SYSTEM STRESS TEST: Caricamento di {TARGET_TOKENS} token. Ignora il contenuto ripetitivo e concentrati sulle immagini alla fine."
    },
    {"type": "text", "text": long_text},
    {"type": "text", "text": "Analizza ora queste 4 immagini finali. Identifica i colori e conferma se riesci a vederle nonostante l'enorme contesto precedente."}
]

for b64_img in image_data:
    content.append({
        "type": "image_url",
        "image_url": {"url": f"data:image/jpeg;base64,{b64_img}"}
    })

# 4. Invio chiamata con parametri estesi (CORRETTI)
print(f"--- Invio richiesta a {MODEL_NAME} ---")
print("Nota: Il 'prefill' di 200k token può richiedere tempo (da 30s a qualche minuto)...")

start_time = time.time()

try:
    response = client.chat.completions.create(
        model=MODEL_NAME,
        messages=[{"role": "user", "content": content}],
        max_tokens=500,  # Aumentato per avere un'analisi completa
        temperature=0.1,
        # Parametri extra inseriti correttamente nel corpo della richiesta
        extra_body={
            "enable_thinking": False, 
        }
    )
    
    end_time = time.time()
    durata = end_time - start_time

    print("\n" + "="*30)
    print(f"TEST COMPLETATO IN: {durata:.2f} secondi")
    print("="*30)
    print("\n--- RISPOSTA DEL MODELLO ---")
    print(response.choices[0].message.content)
    print("\n--- STATISTICHE TOKEN ---")
    print(f"Prompt: {response.usage.prompt_tokens}")
    print(f"Completion: {response.usage.completion_tokens}")
    print(f"Totale: {response.usage.total_tokens}")

except Exception as e:
    print(f"\nERRORE CRITICO: {e}")