from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
import numpy as np
from groq import Groq
import json
import mysql.connector
from mysql.connector import Error
from dotenv import load_dotenv
import os

# =====================================================================
# CHARGEMENT DES VARIABLES D'ENVIRONNEMENT
# =====================================================================
load_dotenv()  # charge automatiquement le fichier .env

app = Flask(__name__)
CORS(app)

# =====================================================================
# CONFIGURATION GROQ (depuis .env)
# =====================================================================
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY manquante ! Verifiez votre fichier .env")

client = Groq(api_key=GROQ_API_KEY)

# =====================================================================
# CONFIGURATION MYSQL (depuis .env)
# =====================================================================
DB_CONFIG = {
    'host':     os.getenv("DB_HOST",     "localhost"),
    'database': os.getenv("DB_NAME",     "mon_projet_pfe"),
    'user':     os.getenv("DB_USER",     "root"),
    'password': os.getenv("DB_PASSWORD", ""),
    'charset':  'utf8mb4'
}

# =====================================================================
# CONNEXION ET CHARGEMENT MYSQL
# =====================================================================
def get_db_connection():
    try:
        connection = mysql.connector.connect(**DB_CONFIG)
        if connection.is_connected():
            print("Connexion a MySQL reussie !")
        return connection
    except Error as e:
        print(f"Erreur de connexion a MySQL: {e}")
        print("Verifiez que XAMPP est demarre (MySQL) et que la base existe")
        return None

def load_countries_from_db():
    print("Chargement des donnees depuis MySQL...")
    connection = get_db_connection()

    if not connection:
        print("Impossible de se connecter a la base de donnees")
        return None

    try:
        query = "SELECT * FROM liste_pays"
        df_pays = pd.read_sql(query, connection)

        if df_pays.empty:
            print("La table liste_pays est vide !")
            return None

        df_pays.columns = [str(col).strip() for col in df_pays.columns]

        # Mapping des colonnes si necessaire
        column_mapping = {
            'Country Name (English)': 'country_name_english',
            'Country Name (French)':  'country_name_french',
            'Country Name (Arabic)':  'country_name_arabic',
            'IOC Code':               'ioc_code',
            'ISO Alpha-3 Code':       'iso_alpha3_code',
            'Continent':              'continent',
            'Population':             'population',
            'Surface Area (km²)':     'surface_area_km2',
            'GDP (current US$)':      'gdp_current_us',
            'GDP per Capita (current US$)': 'gdp_per_capita_current_us',
            'Official Currency':      'official_currency',
            'Official Languages':     'official_languages',
            'Religion':               'religion',
            'Unemployment Rate (%)':  'unemployment_rate',
            'Human Development Index (HDI)': 'human_development_index',
            'Median Age':             'median_age',
            'Urban Population (%)':   'urban_population_percent',
        }

        for old_name, new_name in column_mapping.items():
            if old_name in df_pays.columns:
                df_pays.rename(columns={old_name: new_name}, inplace=True)

        numeric_cols = [
            'population', 'surface_area_km2', 'gdp_current_us',
            'gdp_per_capita_current_us', 'unemployment_rate',
            'human_development_index', 'median_age', 'urban_population_percent'
        ]
        for col in numeric_cols:
            if col in df_pays.columns:
                df_pays[col] = pd.to_numeric(df_pays[col], errors='coerce')

        print(f"{len(df_pays)} pays charges depuis la base de donnees")
        print(f"Colonnes disponibles: {list(df_pays.columns)}")
        return df_pays

    except Error as e:
        print(f"Erreur lors du chargement des donnees: {e}")
        return None
    except Exception as e:
        print(f"Erreur generale: {e}")
        return None
    finally:
        if connection:
            connection.close()

# Chargement au demarrage
df_pays = load_countries_from_db()

if df_pays is not None:
    ALL_COUNTRIES_JSON = df_pays.to_dict(orient='records')
    COUNTRIES_STR = json.dumps(ALL_COUNTRIES_JSON, ensure_ascii=False, default=str)[:10000]
else:
    COUNTRIES_STR = "Aucune donnee disponible"

# =====================================================================
# STOCKAGE DES CONVERSATIONS
# =====================================================================
conversations = {}

# =====================================================================
# FONCTION IA - YARABOT
# =====================================================================
def generer_reponse_ia(question, historique, session_id):

    if df_pays is None:
        return "Desole, la base de donnees n'est pas disponible. Verifiez que XAMPP est demarre et que la table 'liste_pays' existe."

    system_prompt = f"""
You are an expert assistant in geography, economics and world politics, integrated into Yara Insights.
Your name is "YaraBot". You are professional, friendly and helpful.

COMPLETE DATABASE ({len(df_pays)} countries):
Available columns:
- country_name_french: Name in French
- country_name_english: Name in English
- country_name_arabic: Name in Arabic
- continent: Continent
- population: Total population
- surface_area_km2: Area in km2
- gdp_current_us: Total GDP in USD
- gdp_per_capita_current_us: GDP per capita in USD
- official_currency: Official currency
- official_languages: Official languages
- religion: Main religion
- unemployment_rate: Unemployment rate (%)
- human_development_index: HDI (0-1)
- median_age: Median age
- urban_population_percent: Urban population percentage

Data for ALL countries (JSON format):
{COUNTRIES_STR}

ABSOLUTE RULES:

1. LANGUAGE DETECTION:
   - French question -> respond entirely in French.
   - English question -> respond entirely in English.
   - Unclear -> French by default.
   - NEVER mix languages.

2. Never use emojis.

3. GREETINGS: Respond warmly, introduce yourself as YaraBot, explain what you can help with.

4. ALLOWED: questions about countries data only (population, GDP, area, currency, languages, religion, HDI, unemployment, median age, urbanization, comparisons, rankings).

5. FORBIDDEN: anything NOT in the database.
   French: "Je suis desole, cette information ne fait pas partie de ma base de donnees..."
   English: "I am sorry, this information is not available in my database..."

6. Unknown country: "Ce pays ne figure pas dans ma base de donnees." / "This country is not in my database."

7. Never invent data.

8. ALWAYS use HTML TABLE for country data:
<table style="width:100%; border-collapse:collapse; background:#1a1a2e; border-radius:12px; overflow:hidden;">
<thead><tr style="background:linear-gradient(135deg,#ffcc00,#ffaa00);">
<th style="padding:12px; color:#0a0a0a; text-align:left;">Header</th>
</tr></thead>
<tbody><tr style="border-bottom:1px solid rgba(255,204,0,0.1);">
<td style="padding:10px; color:#ffffff;">Value</td>
</tr></tbody></table>

9. Country profile: 2-column table (Indicator | Value).
10. Comparison: one column per country.
11. Ranking: (Rank | Country | Value).
12. Add brief analysis below the table in the same language.
"""

    if historique:
        system_prompt += "\n\nCONVERSATION HISTORY:\n"
        for msg in historique[-4:]:
            system_prompt += f"- {msg['role']}: {msg['content'][:150]}\n"

    system_prompt    = system_prompt[:5000]
    question_limitee = question[:800] if len(question) > 800 else question

    try:
        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": question_limitee}
            ],
            temperature=0.2,
            max_tokens=600
        )
        return response.choices[0].message.content

    except Exception as e:
        if "rate_limit_exceeded" in str(e) or "413" in str(e):
            return "Desole, la requete est trop volumineuse. Veuillez poser une question plus simple."
        return f"Desole, une erreur technique s'est produite: {str(e)}"


# =====================================================================
# ROUTES
# =====================================================================

@app.route('/api/chat', methods=['POST'])
def chat():
    try:
        data       = request.json
        question   = data.get('message', '')
        session_id = data.get('session_id', 'default')

        if not question:
            return jsonify({'reply': 'Veuillez poser une question.'})

        print(f"Question : {question[:100]}...")

        if session_id not in conversations:
            conversations[session_id] = []
        historique = conversations[session_id]

        reponse = generer_reponse_ia(question, historique, session_id)

        historique.append({'role': 'user',      'content': question[:300]})
        historique.append({'role': 'assistant', 'content': reponse[:500]})

        if len(historique) > 10:
            historique = historique[-10:]
        conversations[session_id] = historique

        return jsonify({'reply': reponse})

    except Exception as e:
        print(f"Erreur: {e}")
        return jsonify({'reply': "Desole, une erreur s'est produite. Veuillez reessayer."})


@app.route('/api/clear', methods=['POST'])
def clear_conversation():
    data       = request.json
    session_id = data.get('session_id', 'default')
    if session_id in conversations:
        del conversations[session_id]
    return jsonify({'status': 'ok'})


@app.route('/api/health', methods=['GET'])
def health():
    if df_pays is not None:
        return jsonify({'status': 'ok', 'countries': len(df_pays)})
    return jsonify({'status': 'error', 'countries': 0, 'message': 'Database not connected'})


if __name__ == '__main__':
    print("\n" + "="*60)
    print("SERVEUR CHATBOT - YARABOT")
    print("="*60)
    print(f"Base de donnees : {DB_CONFIG['database']}")
    print(f"Table           : liste_pays")
    print(f"Pays charges    : {len(df_pays) if df_pays is not None else 'ERREUR'}")
    print(f"API             : http://localhost:5002/api/chat")
    print("="*60 + "\n")
    app.run(host='0.0.0.0', port=5002, debug=True)