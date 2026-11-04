import json
import argparse
from nanoid import generate
from tqdm import tqdm
from sqlalchemy import create_engine
from sqlalchemy.sql import text
from openai import OpenAI

# Command-line arguments
parser = argparse.ArgumentParser()
parser.add_argument("-connection_string", help="Database connection string")
parser.add_argument("-openai_key", help="OpenAI API key")

if __name__ == '__main__':

    # Get arguments
    args = parser.parse_args()  

    # Setup openAI connection
    client = OpenAI(api_key=args.openai_key)

    # Connect to SQL
    ssl_args = {'ca': "/etc/ssl/certs/ca-certificates.crt"}
    engine = create_engine(args.connection_string, echo=True, connect_args={'ssl': ssl_args})
    with engine.connect() as connection:

        # Query for all contentTags
        result = connection.execute(text("SELECT name FROM ContentTag"))
        allKeywords = [row[0] for row in result]

        print("allKeywords", allKeywords)
        print("=================")

        # Query all game assets
        result = connection.execute(text("SELECT a.* FROM GameAsset a LEFT JOIN GameAssetTag b ON a.id = b.assetId WHERE b.id IS NULL"))
        for row in tqdm(result):
            assetId = row[0]

            ## Get all the keywords already on this asset
            assetKeywords = connection.execute(text(f"SELECT b.name FROM GameAssetTag a LEFT JOIN ContentTag b ON a.tagId = b.id WHERE a.assetId = '{assetId}'"))
            assetKeywords = [row[0] for row in assetKeywords]

            # Use OpenAI to create categories for this asset
            prompt = f"This is a game asset with the name '{row[1]}'. Based on the name and image can you return a comma-separated list of lower-case, single word, keywords which would make it easy to search up this specific animation"
            response = client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {"type": "image_url", "image_url": {"url": f"{row[3]}"}},
                        ],
                    }
                ],
                 response_format={
                    "type": "json_schema",
                    "json_schema": {
                    "name": "keyword_list",
                    "schema": {
                        "type": "object",
                        "properties": {
                            "keywords": {
                                "type": "array",
                                "items": {"type": "string"}
                            },
                        },
                        "required": ["keywords"],
                        "additionalProperties": False
                    },
                    "strict": True
                }
                }
            )
            keywords_string = response.choices[0].message.content
            keywords = json.loads(keywords_string)
            for keyword in keywords['keywords']:
                
                try:
                    # Only insert if not already in the database
                    if keyword not in allKeywords:                    
                        tagId = generate()
                        connection.execute(text(f"INSERT INTO ContentTag (id, name) VALUES ('{tagId}', '{keyword}')"))
                        allKeywords.append(keyword)
                    else:
                        tagId = connection.execute(text(f"SELECT id FROM ContentTag WHERE name = '{keyword}'")).fetchone()[0]

                    # Only insert if not already on the asset
                    if keyword not in assetKeywords:
                        connection.execute(text(f"INSERT INTO GameAssetTag (id, assetId, tagId) VALUES ('{generate()}', '{assetId}', '{tagId}')"))
                        assetKeywords.append(keyword)

                    # Commit to this
                    connection.commit()

                except Exception as e:
                    print(e)
                    print(f"Error with assetId: {assetId} and keyword: {keyword}")
                    connection.rollback()
            
            
            