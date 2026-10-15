import type { LongTakeUserAssetCatalogItem } from '../../workflows/long-take/types'

interface UserAssetsAnalysisPromptParams {
  script: string
  userAssetCatalog: LongTakeUserAssetCatalogItem[]
  userAssetUnderstandingCatalog?: Array<{
    description: null | string
    entities: {
      brands_or_text: string[]
      characters: string[]
      objects: string[]
    }
    file_id: string
    shortname: string
    tags: string[]
  }>
}

export function buildLongTakeUserAssetsAnalysisPrompt(
  params: UserAssetsAnalysisPromptParams,
): string {
  const { catalog, script, understandingCatalog } = formatCatalogInputs(params)

  return `You are a strict data and attribute extraction utility for an AI video production pipeline.
Your task is to extract referenced files, detailed character profiles, and key objects/products from the provided text.
Output must be valid JSON only.

Follow these rules exactly:

1. FILE EXTRACTION
- Scan User Prompt and Script for referenced images.
- Match references against the provided Image Catalog only.
- If explicit references are missing, use Image Understanding Catalog to infer likely matches.
- Support references like:
  - @img[...](...)
  - [Attached Image: ...]
  - direct filename mentions
- "files" items must include:
  - file_id: catalog file_id
  - file_name: catalog shortname of matched file
  - match_reason: short reason for why the match is correct
- If no matches exist, return "files": [].

2. CHARACTER ATTRIBUTE EXTRACTION
- Extract people/person-like entities as "characters".
- Required fields per character:
  - name
  - age (string or null)
  - ethnicity (string or null)
  - appearance (string or null)
  - file_refs (array of matched file_id values)
- If an attribute is not specified, use null.
- file_refs must only contain file_ids that exist in "files".

3. OBJECT & PRODUCT EXTRACTION
- Extract prominent non-person entities as "objects" (products, props, logos, UI elements, etc.).
- Required fields per object:
  - name
  - brand_or_style (string or null)
  - appearance (string or null)
  - distinctive_features (string or null)
  - file_refs (array of matched file_id values)
- Only include static attributes; ignore temporary states.
- If an attribute is not specified, use null.

4. SUMMARY
- summary.matched = count of unique matched files in "files".
- summary.unresolved = count of unresolved image references in text.

5. OUTPUT FORMAT
- Output ONLY raw JSON.
- Do not output markdown fences.
- Do not output explanations.
- Do not add keys outside this schema:
{
  "files": [
    {
      "file_id": "img_xxx",
      "file_name": "example.png",
      "match_reason": "matched by exact shortname"
    }
  ],
  "characters": [
    {
      "name": "Character Name",
      "age": "33",
      "ethnicity": "Asian",
      "appearance": "short black hair, white hoodie",
      "file_refs": ["img_xxx"]
    }
  ],
  "objects": [
    {
      "name": "Smartphone",
      "brand_or_style": "minimalist",
      "appearance": "silver slab design",
      "distinctive_features": "oversized camera ring",
      "file_refs": ["img_xxx"]
    }
  ],
  "summary": {
    "matched": 1,
    "unresolved": 0
  }
}

Script:
${script}

Image Catalog:
${catalog}

Image Understanding Catalog:
${understandingCatalog}`
}

function formatCatalogInputs(params: UserAssetsAnalysisPromptParams): {
  catalog: string
  script: string
  understandingCatalog: string
} {
  const script = params.script?.trim() || 'No script provided.'
  const catalog =
    params.userAssetCatalog.length > 0
      ? JSON.stringify(
          params.userAssetCatalog.map((item) => ({
            aliases: item.aliases,
            file_id: item.fileId,
            mime: item.mime,
            shortname: item.shortname,
            storage_uri: item.storageUri,
          })),
          null,
          2,
        )
      : '[]'
  const understandingCatalog = JSON.stringify(params.userAssetUnderstandingCatalog || [], null, 2)
  return { catalog, script, understandingCatalog }
}
