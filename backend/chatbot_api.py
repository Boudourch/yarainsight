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
load_dotenv()

app = Flask(__name__)
CORS(app)

# =====================================================================
# CONFIGURATION GROQ
# =====================================================================
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY manquante ! Verifiez votre fichier .env")

client = Groq(api_key=GROQ_API_KEY)

# =====================================================================
# CONFIGURATION MYSQL
# =====================================================================
DB_CONFIG = {
    'host':     '127.0.0.1',
    'database': 'mon_projet_pfe',
    'user':     'root',
    'password': 'yara*INSIGHTS*2026',
    'charset':  'utf8mb4'
}

# =====================================================================
# CONNEXION MYSQL
# =====================================================================
def get_db_connection():
    try:
        connection = mysql.connector.connect(**DB_CONFIG)
        if connection.is_connected():
            print("Connexion a MySQL reussie !")
        return connection
    except Error as e:
        print(f"Erreur de connexion a MySQL: {e}")
        return None

# =====================================================================
# CHARGEMENT TABLE liste_pays
# =====================================================================
def load_countries_from_db():
    print("Chargement des donnees depuis MySQL (liste_pays)...")
    connection = get_db_connection()
    if not connection:
        return None
    try:
        df_pays = pd.read_sql("SELECT * FROM liste_pays", connection)
        if df_pays.empty:
            return None
        df_pays.columns = [str(col).strip() for col in df_pays.columns]
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
        print(f"{len(df_pays)} pays charges depuis liste_pays")
        return df_pays
    except Exception as e:
        print(f"Erreur chargement liste_pays: {e}")
        return None
    finally:
        if connection:
            connection.close()

# =====================================================================
# CHARGEMENT TABLES AI READINESS 2019-2025
# =====================================================================
AI_YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025]

def load_ai_readiness_from_db():
    """
    Charge toutes les tables ai_readiness_YYYY dans un dict {annee: DataFrame}.
    Detecte automatiquement les colonnes disponibles dans chaque table.
    """
    print("Chargement des donnees AI Readiness 2019-2025...")
    connection = get_db_connection()
    if not connection:
        return {}

    ai_data = {}
    try:
        for year in AI_YEARS:
            table_name = f"ai_readiness_{year}"
            try:
                df = pd.read_sql(f"SELECT * FROM `{table_name}`", connection)
                if df.empty:
                    print(f"  Table {table_name} vide, ignoree.")
                    continue
                df.columns = [str(col).strip() for col in df.columns]
                # Normaliser les colonnes numeriques detectees automatiquement
                for col in df.columns:
                    try:
                        df[col] = pd.to_numeric(df[col], errors='ignore')
                    except Exception:
                        pass
                ai_data[year] = df
                print(f"  {table_name}: {len(df)} lignes, colonnes: {list(df.columns)}")
            except Error as e:
                print(f"  Table {table_name} non trouvee ou erreur: {e}")
    except Exception as e:
        print(f"Erreur globale AI readiness: {e}")
    finally:
        if connection:
            connection.close()

    print(f"AI Readiness charge pour {len(ai_data)} annees: {list(ai_data.keys())}")
    return ai_data

# =====================================================================
# PREPARATION DU CONTEXTE AI READINESS POUR LE PROMPT
# =====================================================================
def build_ai_readiness_context(ai_data: dict) -> str:
    """
    Construit un résumé structuré des tables AI Readiness pour le system prompt.
    """
    if not ai_data:
        return "Aucune donnee AI Readiness disponible."

    lines = []
    lines.append(f"=== AI READINESS DATA (tables disponibles: {sorted(ai_data.keys())}) ===")

    for year in sorted(ai_data.keys()):
        df = ai_data[year]
        cols = list(df.columns)
        lines.append(f"\n--- {year} ({len(df)} pays) ---")
        lines.append(f"Colonnes: {', '.join(cols)}")

        # Identifier colonne pays et colonne score principal
        country_col  = _detect_country_col(cols)
        score_col    = _detect_score_col(cols)

        if country_col and score_col:
            try:
                top5 = (
                    df[[country_col, score_col]]
                    .dropna()
                    .sort_values(score_col, ascending=False)
                    .head(5)
                )
                lines.append(f"Top 5 par {score_col}:")
                for _, row in top5.iterrows():
                    lines.append(f"  {row[country_col]}: {row[score_col]}")
            except Exception:
                pass

    # Ajouter un sample JSON léger (max 3 pays par année pour éviter dépassement tokens)
    lines.append("\n=== SAMPLE JSON PAR ANNEE (3 premiers pays) ===")
    for year in sorted(ai_data.keys()):
        df = ai_data[year]
        sample = df.head(3).to_dict(orient='records')
        lines.append(f"\n{year}: {json.dumps(sample, ensure_ascii=False, default=str)[:1500]}")

    return "\n".join(lines)


def _detect_country_col(cols):
    """Detecte la colonne pays parmi les noms de colonnes."""
    priority = ['country', 'Country', 'pays', 'Pays', 'country_name',
                'Country Name', 'name', 'Name', 'country_name_english']
    for p in priority:
        if p in cols:
            return p
    for col in cols:
        if 'country' in col.lower() or 'pays' in col.lower() or 'name' in col.lower():
            return col
    return cols[0] if cols else None


def _detect_score_col(cols):
    """Detecte la colonne score principal (AI readiness score)."""
    priority = ['score', 'Score', 'ai_score', 'AI Score', 'readiness_score',
                'total_score', 'index', 'rank', 'Rank', 'value', 'Value']
    for p in priority:
        if p in cols:
            return p
    for col in cols:
        if any(k in col.lower() for k in ['score', 'index', 'readiness', 'rank', 'value']):
            return col
    # Prendre la 2eme colonne numerique disponible
    for col in cols[1:]:
        return col
    return None


# =====================================================================
# FONCTION ANALYTIQUE : EVOLUTION D'UN PAYS SUR 2019-2025
# =====================================================================
def get_country_evolution(country_query: str, ai_data: dict) -> dict:
    """
    Retourne l'évolution du score AI Readiness d'un pays sur toutes les années.
    Retourne un dict {annee: {col: valeur}} ou {} si non trouvé.
    """
    evolution = {}
    for year in sorted(ai_data.keys()):
        df = ai_data[year]
        country_col = _detect_country_col(list(df.columns))
        if not country_col:
            continue
        mask = df[country_col].astype(str).str.lower().str.contains(
            country_query.lower(), na=False
        )
        rows = df[mask]
        if not rows.empty:
            evolution[year] = rows.iloc[0].to_dict()
    return evolution


# =====================================================================
# FONCTION ANALYTIQUE : COMPARAISON DE DEUX PAYS
# =====================================================================
def get_comparison_data(country1: str, country2: str, ai_data: dict, year=None) -> dict:
    """
    Compare deux pays pour une année donnée (ou la plus récente disponible).
    """
    years_available = sorted(ai_data.keys(), reverse=True)
    if year and year in ai_data:
        target_year = year
    elif years_available:
        target_year = years_available[0]
    else:
        return {}

    df = ai_data[target_year]
    country_col = _detect_country_col(list(df.columns))
    if not country_col:
        return {}

    def find_row(query):
        mask = df[country_col].astype(str).str.lower().str.contains(query.lower(), na=False)
        rows = df[mask]
        return rows.iloc[0].to_dict() if not rows.empty else None

    r1 = find_row(country1)
    r2 = find_row(country2)
    return {'year': target_year, 'country1': r1, 'country2': r2, 'columns': list(df.columns)}


# =====================================================================
# CHARGEMENT AU DEMARRAGE
# =====================================================================
df_pays  = load_countries_from_db()
ai_data  = load_ai_readiness_from_db()

if df_pays is not None:
    ALL_COUNTRIES_JSON = df_pays.to_dict(orient='records')
    COUNTRIES_STR = json.dumps(ALL_COUNTRIES_JSON, ensure_ascii=False, default=str)[:8000]
else:
    COUNTRIES_STR = "Aucune donnee disponible"

AI_READINESS_CONTEXT = build_ai_readiness_context(ai_data)

# =====================================================================
# STOCKAGE DES CONVERSATIONS
# =====================================================================
conversations = {}

# =====================================================================
# FONCTION IA - YARABOT (ENRICHIE)
# =====================================================================
def generer_reponse_ia(question: str, historique: list, session_id: str) -> str:

    if df_pays is None and not ai_data:
        return "Desole, la base de donnees n'est pas disponible."

    # --- Contexte pays de base ---
    pays_count = len(df_pays) if df_pays is not None else 0
    ai_years_str = str(sorted(ai_data.keys())) if ai_data else "aucune"

    system_prompt = f"""
You are an expert assistant in geography, economics, AI policy and digital readiness, integrated into Yara Insights.
Your name is "YaraBot". You are professional, friendly and helpful.

=== DATABASE OVERVIEW ===
- Table liste_pays: {pays_count} countries with general indicators (population, GDP, HDI, etc.)
- Tables AI Readiness: {ai_years_str} (yearly AI readiness scores and sub-indicators per country)

=== GENERAL COUNTRIES DATA (liste_pays) ===
Available columns: country_name_french, country_name_english, country_name_arabic, continent,
population, surface_area_km2, gdp_current_us, gdp_per_capita_current_us, official_currency,
official_languages, religion, unemployment_rate, human_development_index, median_age, urban_population_percent.

Sample data:
{COUNTRIES_STR[:4000]}

=== AI READINESS DATA (2019-2025) ===
{AI_READINESS_CONTEXT[:4000]}

=== ABSOLUTE RULES ===

1. LANGUAGE:
   - French question -> respond entirely in French.
   - English question -> respond entirely in English.
   - NEVER mix languages.

2. No emojis.

3. SCOPE: ONLY answer questions about data available in the database:
   - General country indicators (from liste_pays)
   - AI Readiness scores, rankings, sub-indicators (from ai_readiness_2019 to ai_readiness_2025)
   - Evolutions, trends, comparisons between years or countries
   - Factor analysis (why a country improved or declined in AI readiness)
   For anything outside this scope: "Je suis desole, cette information ne fait pas partie de ma base de donnees."

4. NEVER invent data. If a country or year is not in the database, say so explicitly.

5. ALWAYS use HTML tables for structured data (country profiles, comparisons, rankings, evolutions).

TABLE STYLE TO USE:
<table style="width:100%;border-collapse:collapse;background:#1a1a2e;border-radius:12px;overflow:hidden;">
<thead><tr style="background:linear-gradient(135deg,#ffcc00,#ffaa00);">
<th style="padding:12px;color:#0a0a0a;text-align:left;">Header</th>
</tr></thead>
<tbody>
<tr style="border-bottom:1px solid rgba(255,204,0,0.1);">
<td style="padding:10px;color:#ffffff;">Value</td>
</tr>
</tbody></table>

6. TABLE FORMATS:
   - Country profile (general): 2 columns (Indicator | Value)
   - Country AI profile: 2 columns (Indicator | Value) with all available AI sub-indicators
   - Year-over-year evolution: columns = (Year | Score | Rank | Change | Trend)
   - Country comparison: one column per country + difference column
   - Continental ranking: columns = (Rank | Country | Score | Change vs prev year)

7. FACTOR ANALYSIS (when asked why a country improved/declined):
   - Compare sub-indicator values between years
   - Identify which sub-indicators changed most
   - Provide a 3-5 sentence qualitative analysis BELOW the table
   - Mention economic, governance, infrastructure factors if available in the data

8. ALWAYS add a brief analytical paragraph below every table (2-4 sentences) in the same language as the question.

9. GREETINGS: respond warmly, introduce yourself as YaraBot, explain your capabilities briefly.
"""

    if historique:
        system_prompt += "\n\n=== CONVERSATION HISTORY ===\n"
        for msg in historique[-4:]:
            system_prompt += f"- {msg['role']}: {msg['content'][:150]}\n"

    # Limiter les tailles pour Groq
    system_prompt    = system_prompt[:6000]
    question_limitee = question[:800]

    try:
        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system",  "content": system_prompt},
                {"role": "user",    "content": question_limitee}
            ],
            temperature=0.2,
            max_tokens=800
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
    return jsonify({
        'status':   'ok' if (df_pays is not None or ai_data) else 'error',
        'countries': len(df_pays) if df_pays is not None else 0,
        'ai_readiness_years': sorted(ai_data.keys()) if ai_data else []
    })


@app.route('/api/ai_evolution', methods=['GET'])
def ai_evolution():
    """
    Endpoint utilitaire : retourne l'evolution AI Readiness d'un pays.
    Usage: GET /api/ai_evolution?country=Tunisia
    """
    country = request.args.get('country', '')
    if not country:
        return jsonify({'error': 'Parametre country manquant'}), 400
    evolution = get_country_evolution(country, ai_data)
    if not evolution:
        return jsonify({'error': f'Pays "{country}" non trouve dans les tables AI Readiness'}), 404
    return jsonify({'country': country, 'evolution': evolution})


@app.route('/api/ai_compare', methods=['GET'])
def ai_compare():
    """
    Endpoint utilitaire : compare deux pays sur une annee.
    Usage: GET /api/ai_compare?c1=Tunisia&c2=Morocco&year=2024
    """
    c1   = request.args.get('c1', '')
    c2   = request.args.get('c2', '')
    year = request.args.get('year', None)
    if year:
        try:
            year = int(year)
        except ValueError:
            year = None
    if not c1 or not c2:
        return jsonify({'error': 'Parametres c1 et c2 requis'}), 400
    result = get_comparison_data(c1, c2, ai_data, year)
    return jsonify(result)


if __name__ == '__main__':
    print("\n" + "="*60)
    print("SERVEUR CHATBOT - YARABOT")
    print("="*60)
    print(f"Base de donnees    : {DB_CONFIG['database']}")
    print(f"Pays charges       : {len(df_pays) if df_pays is not None else 'ERREUR'}")
    print(f"AI Readiness annees: {sorted(ai_data.keys()) if ai_data else 'ERREUR'}")
    print(f"API chat           : http://localhost:5002/api/chat")
    print(f"API evolution      : http://localhost:5002/api/ai_evolution?country=Tunisia")
    print(f"API compare        : http://localhost:5002/api/ai_compare?c1=Tunisia&c2=Morocco")
    print("="*60 + "\n")
    app.run(host='0.0.0.0', port=5002, debug=True)