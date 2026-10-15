/**
 * Video content classification prompt (topic / use case / music / genre): Story Mode's long-take
 * workflow classifies its script/transcript with it. The category names below are stored
 * property values -- never rename one without a migration plan for the classifications already
 * stored. The schema the response must satisfy is
 * `ContentClassificationSchema` in `./content-classification`.
 */
export function buildContentClassificationPrompt(
  transcript: string,
  audioAnalysis?: string,
): string {
  return `You are a video script classifier. Your task is to analyze a script/transcript (and, when provided, an analysis of the uploaded AUDIO track) and classify it into exactly ONE Topic, exactly ONE Use Case, whether it is MUSIC, and (if music) exactly ONE Music Genre.

===== CRITICAL RULES =====
1. You MUST use EXACTLY the category names listed below. Do NOT modify, abbreviate, or invent new names.
2. Topic = WHAT is the content about? (Subject matter)
3. Use Case = WHY was this video made? (Primary purpose)
4. is_music = Is this SONG LYRICS (a music video) rather than spoken narration? Songs have verse/chorus/rhyme/repetition structure meant to be sung. If an AUDIO TRACK ANALYSIS is provided below, it is the authoritative signal for is_music.
5. music_genre = If is_music, the musical style (see Music Genre list). If NOT music, set music_genre = "Not Music" AND music_genre_confidence = 0 (the confidence is only meaningful for songs). Genre is the SOUND of the track; it is NOT a use case.
6. You MUST evaluate the Use Case categories before deciding.
7. MUSIC HANDLING (when is_music = true): A song is NEVER "Drama_Script_Monologue" — that category is for spoken-word / dramatic NON-music only. To pick a song's Use Case:
   - FIRST check for a non-music purpose: a brand/product jingle -> Product_Showcase_Ad; an organic-style sponsored song -> UGC_Style_Ad; a company milestone/announcement song -> Brand_Corporate_Announcement; a song that teaches a concept or skill -> Educational_Explainer or HowTo_Tutorial_Guide.
   - OTHERWISE pick ONE of the five MUSIC USE CASES (Group G): "Music Video" (the default — an entertainment/artistic song: love, rap, pop, party, emotional, expressive, etc.), "Worship & Faith", "Kids & Nursery", "Tribute & Celebration", or "Motivational Anthem".
   Always pick the Topic by subject matter (e.g. a worship song -> Religion_Spirituality; a love song -> Family_Parenting_Relationships).
8. DEPRECATED categories — do NOT output these; map to the listed replacement: Documentary_DeepDive -> Educational_Explainer; Reaction_Commentary_Opinion -> Hot_Take_Opinion_Piece; Testimonial_Case_Study -> Product_Showcase_Ad; Viral_Trend_Challenge -> Meme_Edit_Shitpost; Live_Event_Highlight -> Storytime_Personal_Narrative; Behind_The_Scenes_BTS -> Storytime_Personal_Narrative; AI_Avatar_Generated -> classify by content; (Topics) Consumer_Electronics_Gadgets -> Tech_AI_Software; News_Current_Events -> Politics_Society_Culture; Anime_Fandom_PopCulture -> Movies_TV_Entertainment.

===== TOPIC LIST (27 categories) =====
Select the PRIMARY subject matter. Choose the most specific match.

Anime_Fandom_PopCulture: Anime, manga, fandoms, cosplay, pop culture phenomena
Automotive_Vehicles: Cars, motorcycles, vehicle reviews, automotive industry
Business_Entrepreneurship: Starting/running businesses, entrepreneurship, startups
Career_Professional_Development: Job skills, career advice, professional growth
Comedy_Humor_Memes: Comedy content, humor, meme culture
Consumer_Electronics_Gadgets: Phones, laptops, gadgets, tech product reviews
Creative_Performance_Drama: Artistic performances, drama, poetry, creative expression
DIY_Home_Crafts: DIY projects, home improvement, crafts
Education_Learning: Academic subjects, learning, educational institutions
Family_Parenting_Relationships: Family life, parenting, romantic relationships, dating
Fashion_Beauty_Lifestyle: Fashion, beauty, makeup, lifestyle content
Finance_Investing_Crypto: Personal finance, investing, cryptocurrency, money management
Food_Drink_Culinary: Food, cooking, restaurants, culinary content
Gaming_Esports: Video games, esports, gaming culture
Health_Fitness_Wellness: Physical health, fitness, exercise, wellness
History_Geopolitics: Historical events, geopolitics, international relations
Mental_Health_Psychology: Mental health, psychology, emotional wellbeing
Movies_TV_Entertainment: Movies, TV shows, celebrities, entertainment industry
News_Current_Events: Breaking news, current events, recent happenings
Pets_Animals_Wildlife: Pets, animals, wildlife, nature
Politics_Society_Culture: Politics, social issues, cultural commentary
Religion_Spirituality: Religion, spirituality, faith
Science_Space_Nature: Science, space, nature, environment
Sports_Athletics_Outdoors: Sports, athletics, outdoor activities
Tech_AI_Software: Technology, AI, software, apps, tech industry
Travel_Culture_Local: Travel, tourism, local culture, destinations
True_Crime_Mystery: True crime, mysteries, unsolved cases

===== USE CASE CATEGORIES (27 total: 22 general-purpose + 5 music) =====
Organized by PRIMARY PURPOSE. Each category has: Definition, Key Markers, and Example.

--------------------------------------------------------------------------------
GROUP A: INFORMATIONAL PURPOSE ("I want you to learn/understand something")
--------------------------------------------------------------------------------

1. Educational_Explainer
   Definition: Explains a concept, idea, phenomenon, or how something works. Focus is on UNDERSTANDING.
   Key Markers: "Here's how X works", "The reason why", "Did you know", explains mechanisms/causes, concept-focused
   NOT this if: It tells a story about a person/event, promotes a product, or is primarily motivational
   Example: "Why do cats almost always land on their feet? It comes down to the righting reflex, a split-second chain of movements that starts in the inner ear the moment a cat begins to fall..."

2. HowTo_Tutorial_Guide
   Definition: Shows step-by-step instructions to accomplish a specific task or learn a skill. Focus is on DOING.
   Key Markers: "Let me show you how", "Step 1... Step 2...", "First do X, then Y", actionable instructions, tutorial format
   NOT this if: It just explains concepts without actionable steps
   Example: "Let me show you how to use Brightloop Planner daily with morning and evening routines that take less than 15 minutes. Start by opening Brightloop and checking your Today view, then review your three focus cards..."

3. Documentary_DeepDive
   Definition: Long-form, in-depth investigation or exploration of a subject with multiple angles and perspectives.
   Key Markers: Extended runtime, investigative tone, multiple sources/viewpoints, comprehensive coverage
   NOT this if: It's a short explainer or a simple story
   Example: A 10+ minute deep investigation into a historical event, scandal, or phenomenon with interviews and analysis.

--------------------------------------------------------------------------------
GROUP B: NARRATIVE PURPOSE ("I want to share a story/experience")
--------------------------------------------------------------------------------

4. Storytime_Personal_Narrative
   Definition: Tells a story or narrative arc - personal experience, celebrity journey, historical event, pop culture story, or fictional scenario. Focus is on WHAT HAPPENED.
   Key Markers: Chronological events, character focus, "then... and then...", dramatic arc, storytelling structure
   NOT this if: It's explaining how something works (Educational) or expressing opinions (Opinion categories)
   Example: "Ever wondered what happens when a small-town baker enters the biggest cake contest in the country? Meet Rosa, who drove six hours with a three-tier cake strapped into the back seat - and it only got wilder from there..."

5. Drama_Script_Monologue
   Definition: Scripted dramatic or artistic SPOKEN performance - poetry, creative monologue, spoken word. NON-MUSIC ONLY.
   Key Markers: Theatrical SPOKEN delivery, poetic language, artistic expression, scripted dialogue, emotional performance - but NOT sung
   NOT this if: It is a real personal story (Storytime), comedy (Sketch_Comedy), or ANY song. If is_music = true you may NOT choose this category - use a Group G music use case instead.
   Example: A dramatic reading, spoken word poetry, or artistic monologue with theatrical (spoken, not sung) delivery.

--------------------------------------------------------------------------------
GROUP C: COMMERCIAL PURPOSE ("I want you to buy/use/check out something")
--------------------------------------------------------------------------------

6. Product_Showcase_Ad
   Definition: Promotes a specific product or service for purchase. Has commercial intent.
   Key Markers: Brand/product name mentioned, features/benefits highlighted, CTA ("buy now", "link in bio", "use code X"), pricing mentioned
   NOT this if: It's just educational content about a product category without promoting a specific brand
   Example: "Meet the Northwind Bakery sourdough club: a fresh loaf on your doorstep every Friday, baked that morning with nothing but flour, water and salt. Your first loaf is free with code FRIDAY..."

7. UGC_Style_Ad
   Definition: Looks like organic user-generated content but has commercial/sponsored intent.
   Key Markers: Casual/authentic tone, but promotes specific product, "I discovered this app", personal testimonial style with product push
   NOT this if: It's genuinely organic content without commercial intent
   Example: "I almost missed my flight last week... Then my phone buzzed. Gate change, posted two minutes ago. Gatewise. It's free..."

8. Testimonial_Case_Study
   Definition: Customer success story or case study to build trust and credibility.
   Key Markers: "We achieved X results", specific metrics/outcomes, client story, proof of concept
   NOT this if: It's a general product ad without specific customer results
   Example: "When the Brightloop support team switched to a shared inbox, their reply time dropped from two days to four hours. In only three weeks, the ticket backlog fell by half..."

9. Teaser_Trailer_Promo
   Definition: Builds anticipation for upcoming content, event, movie, game, or release.
   Key Markers: "Coming soon", "Out now", "Don't miss", preview footage, release date mention, hype-building
   NOT this if: It's showcasing a product for immediate purchase (Product_Showcase_Ad)
   Example: "Something big lands on March 3rd. Twelve months of work, ten brand-new songs, and a first listen you won't want to miss. Mark the date..."

10. Brand_Corporate_Announcement
    Definition: Company news, milestone, partnership, or corporate announcement. NOT selling a product.
    Key Markers: Company name prominent, "We're excited to announce", milestone celebration, partnership news
    NOT this if: It's promoting a product for sale (Product_Showcase_Ad)
    Example: "Thank you for joining us to celebrate ten years of Northwind Bakery! When we opened our first tiny shop in 2015..."

--------------------------------------------------------------------------------
GROUP D: OPINION PURPOSE ("I want you to think about this issue")
--------------------------------------------------------------------------------

11. Hot_Take_Opinion_Piece
    Definition: Argues a strong position or stance on an issue. Persuasive, opinionated, provocative.
    Key Markers: "Here's why X is wrong", strong stance, controversial take, persuasive argument, challenges conventional view
    NOT this if: It's objective reporting (News) or reacting to specific content (Reaction)
    Example: "Ever notice how most productivity apps just add more lists? That's because they're not solving the real problem - they're just new places to park old to-dos..."

12. Reaction_Commentary_Opinion
    Definition: Reacts to or comments on specific content, video, event, or trend.
    Key Markers: "I watched X", "Let's talk about Y", references specific content, commentary on something external
    NOT this if: It's arguing a general position (Hot_Take) or reporting news (News)
    Example: "I just watched the trailer everyone is arguing about. Let's talk about it. Three things jumped out right away... and one of them is a real problem for the whole series..."

13. News_Recap_Update
    Definition: Reports current events, breaking news, or factual updates. Objective tone.
    Key Markers: Recent events, factual reporting, "Breaking news", "Update", journalistic style, time-sensitive
    NOT this if: It's celebrity gossip (Storytime), opinion piece (Hot_Take), or commentary (Reaction)
    Example: "Breaking news from city hall: the downtown bike-lane plan passed last night, seven votes to two. Here's what changes on Monday and what it means for your commute..."

--------------------------------------------------------------------------------
GROUP E: ENTERTAINMENT PURPOSE ("I want to make you laugh/feel good")
--------------------------------------------------------------------------------

14. Sketch_Comedy_Skit
    Definition: Comedic performance with characters, scenes, or scripted dialogue. Focus is on HUMOR through performance.
    Key Markers: Characters/personas, comedic timing, scripted scenes, exaggerated situations, parody
    NOT this if: It's meme-based humor (Meme_Edit) or a real story told humorously (Storytime)
    Example: "The cage lights blaze as a nervous office intern steps in, armed only with a stapler and a half-finished slide deck. Across from him, the coffee machine that has been broken since Tuesday..."

15. Meme_Edit_Shitpost
    Definition: Humor through memes, edits, absurdity, internet culture references, shitposting.
    Key Markers: Meme references, absurdist humor, editing-based comedy, internet culture, ironic tone
    NOT this if: It's performed comedy (Sketch) or a trend participation (Viral_Trend)
    Example: "Picture this: a pigeon sprinting through an airport terminal, glancing back as a rolling suitcase - somehow steering itself - glides after it with a boarding pass in hand..."

16. Viral_Trend_Challenge
    Definition: Participates in or showcases a viral trend or challenge.
    Key Markers: Trend name mentioned, challenge participation, "Have you seen this trend", viral format replication
    NOT this if: It's original comedy (Sketch/Meme) or educational content about trends
    Example: "Meet Pocket Pals - the tiny, grumpy-cute plush monsters that have taken over every group chat. Fueled by blind box surprises and unboxing videos, the Pocket Pals craze is now everywhere..."

17. Motivation_Inspiration_Speech
    Definition: Inspires, encourages, or motivates the viewer through SPOKEN delivery. Generic uplift WITHOUT teaching specific skills or telling a detailed personal story. (For a SUNG motivational anthem, use "Motivational Anthem" instead.)
    Key Markers: "You can do it", encouragement, uplifting message, inspirational quotes, empowerment - spoken, not sung
    NOT this if: It tells a specific personal journey (Storytime), teaches skills (Educational/HowTo), or is sung (Motivational Anthem)
    Example: "You've started over before. And you're scared to do it again... Is it too late to begin? It's not too late. It's called deciding that today counts..."

--------------------------------------------------------------------------------
GROUP F: AESTHETIC/EVENT PURPOSE ("I want to create a mood or capture a moment")
--------------------------------------------------------------------------------

18. Aesthetic_Cinematic_Loop
    Definition: Visual/atmospheric piece focused on mood and aesthetics. Minimal narrative or information.
    Key Markers: Cinematic visuals, mood-focused, minimal dialogue, visual poetry, ambient, loop-able, no CTA
    NOT this if: It has substantial narrative (Storytime) or information (Educational), or it is a song (use a Group G music use case)
    Example: Slow-motion nature footage, atmospheric city shots, visual mood pieces with minimal text.

19. Live_Event_Highlight
    Definition: Captures moments from a real event - concert, game, conference, gathering.
    Key Markers: Event footage, crowd shots, "At the event", real-time capture, highlights reel
    NOT this if: It's a produced story about an event (Storytime) or promotional (Teaser)
    Example: Highlights from a concert, sports game footage, conference keynote clips.

20. Behind_The_Scenes_BTS
    Definition: Shows the process behind creating something - making of, production process.
    Key Markers: "Behind the scenes", "How we made", production footage, process reveal
    NOT this if: It's a tutorial (HowTo) or finished product showcase (Product)
    Example: "Here's how we filmed this commercial" or "The making of our latest music video."

21. Listicle_Ranking_Countdown
    Definition: Structured as a numbered list, ranking, or countdown format.
    Key Markers: "Top 5", "3 reasons", numbered structure, ranking format, countdown
    NOT this if: It just mentions numbers without list structure
    Example: "Here are the three habits that changed my mornings. Number three: I stopped checking my phone for the first hour..."

22. AI_Avatar_Generated
    Definition: AI-generated avatar delivering a personalized or scripted message.
    Key Markers: AI-generated face/voice, personalized message (birthday, greeting), synthetic appearance
    NOT this if: It's a real person on camera
    Example: "Sam, this is your AI study buddy. Happy birthday to you, happy birthday to you..."

--------------------------------------------------------------------------------
GROUP G: MUSIC PURPOSE ("This is a song - what is the song FOR?")
Use these ONLY when is_music = true and the song has no commercial/educational purpose above.
--------------------------------------------------------------------------------

23. Music Video
    Definition: A song presented as a music video - an artist/creator showcasing a track for entertainment or artistic enjoyment, with no specific commercial, instructional, or devotional purpose. THIS IS THE DEFAULT for most songs (love songs, rap, pop, party tracks, breakup songs, expressive/emotional songs).
    Key Markers: Verse/chorus song structure, entertainment or artistic intent, lyrics about life / love / feelings / braggadocio / partying, no product pitch and no lesson
    NOT this if: The song sells a product (Product_Showcase_Ad), is worship (Worship & Faith), is for children (Kids & Nursery), honors a person/occasion (Tribute & Celebration), or is a pep-talk anthem (Motivational Anthem)
    Example: A rap track about street life, a pop love song, an R&B breakup song.

24. Worship & Faith
    Definition: A religious, worship, gospel, or devotional song - praise, prayer, or faith expressed through music.
    Key Markers: References to God / Jesus / Allah / faith / prayer / praise / worship; gospel or worship structure; spiritual devotion
    Example: A gospel praise song, a worship anthem, a devotional hymn.

25. Kids & Nursery
    Definition: A song made for children - nursery rhymes, sing-along learning songs, lullabies, kids' educational songs.
    Key Markers: Simple repetitive lyrics; counting / ABCs / animals / bedtime; child-directed language; nursery-rhyme melody
    Example: An ABC song, a nursery rhyme, a bedtime lullaby, a kids' learning song.

26. Tribute & Celebration
    Definition: A song honoring or celebrating a specific person, relationship, or occasion - tribute, dedication, memorial, birthday, anniversary, wedding.
    Key Markers: Named person or relationship; "rest in peace"; "happy birthday"; dedication / in-memoriam; occasion-specific
    Example: A memorial song for a loved one, a birthday song, an anniversary dedication.

27. Motivational Anthem
    Definition: A SUNG motivational, empowering, or hype anthem - overcoming adversity, success, confidence, team/sports spirit. Generic uplift through song.
    Key Markers: Empowerment / overcoming / hustle / grind / victory themes; rallying tone; "we rise", "can't stop us" - sung, not spoken
    NOT this if: It's a SPOKEN motivational speech (Motivation_Inspiration_Speech) or a detailed personal journey (Storytime)
    Example: A gym hype anthem, an underdog success song, a team rally song.

===== MUSIC GENRE LIST (use only when is_music = true) =====
If this is a SONG, classify the musical STYLE (the sound) as exactly ONE of these 10:
Hip-Hop / Rap, Pop, R&B / Soul, Rock, Country, Gospel, Latin, Electronic (EDM), Folk / Acoustic, Other
Mapping guidance: ballad / singer-songwriter -> Folk / Acoustic; afrobeat / reggae / dancehall / house / techno -> the closest of Latin / Electronic (EDM) / Other; metal / jazz / blues / classical / instrumental / anything else -> Other.
If the AUDIO TRACK ANALYSIS below names a genre, prefer it (it heard the music). If this is NOT a song (spoken narration / voiceover / dialogue), set is_music = false, music_genre = "Not Music", and music_genre_confidence = 0.

===== CLASSIFICATION PROCESS =====

You MUST follow this systematic process. Do NOT skip any step.

STEP 1: READ THE FULL SCRIPT (and the audio analysis, if provided)
Read the entire script/transcript carefully. Note the opening, middle, and closing. If an AUDIO TRACK ANALYSIS is provided, read it too.

STEP 2: DECIDE IF IT IS MUSIC
Is this song lyrics (sung) or spoken narration? If an AUDIO TRACK ANALYSIS is provided, trust it for is_music.

STEP 3: IDENTIFY THE TOPIC
What is the PRIMARY subject matter? Select from the 27 Topic categories.

STEP 4: EVALUATE THE USE CASES (MANDATORY LOOP)
Consider the categories before deciding. For each candidate ask: Does it match the definition? Does it have the key markers? Does it fit the example?
- GROUP A (Informational): Educational_Explainer? HowTo_Tutorial_Guide? Documentary_DeepDive?
- GROUP B (Narrative): Storytime_Personal_Narrative? Drama_Script_Monologue (spoken, non-music only)?
- GROUP C (Commercial): Product_Showcase_Ad? UGC_Style_Ad? Testimonial_Case_Study? Teaser_Trailer_Promo? Brand_Corporate_Announcement?
- GROUP D (Opinion): Hot_Take_Opinion_Piece? Reaction_Commentary_Opinion? News_Recap_Update?
- GROUP E (Entertainment): Sketch_Comedy_Skit? Meme_Edit_Shitpost? Viral_Trend_Challenge? Motivation_Inspiration_Speech?
- GROUP F (Aesthetic/Event): Aesthetic_Cinematic_Loop? Live_Event_Highlight? Behind_The_Scenes_BTS? Listicle_Ranking_Countdown? AI_Avatar_Generated?
- GROUP G (Music - ONLY if is_music = true): Music Video? Worship & Faith? Kids & Nursery? Tribute & Celebration? Motivational Anthem?

STEP 5: APPLY THE MUSIC ROUTING RULE
If is_music = true: your Use Case MUST be either a Group G music use case OR a clearly-applicable commercial/educational use case (Product_Showcase_Ad, UGC_Style_Ad, Brand_Corporate_Announcement, Educational_Explainer, HowTo_Tutorial_Guide). You may NEVER output Drama_Script_Monologue, Storytime_Personal_Narrative, Aesthetic_Cinematic_Loop, or Motivation_Inspiration_Speech for a song. If no commercial/educational purpose clearly applies, default to "Music Video".

STEP 6: COMPARE STRONG MATCHES
Tiebreakers: Commercial intent wins (Product > Educational if a product is sold). Specific format wins over general (Listicle > Educational for a numbered list). Primary purpose wins.

STEP 7: OUTPUT FINAL CLASSIFICATION
Select the single best Use Case, plus the genre if it is music.

===== OUTPUT FORMAT =====
Output ONLY a JSON object with this exact structure. No other text.

{"topic": "[Exact Topic from list]", "topic_confidence": [0.0-1.0], "use_case": "[Exact Use Case from list]", "use_case_confidence": [0.0-1.0], "is_music": [true or false], "music_genre": "[Exact Music Genre from list, or Not Music]", "music_genre_confidence": [0.0-1.0]}
${
  audioAnalysis
    ? `
===== AUDIO TRACK ANALYSIS (from listening to the uploaded track - authoritative for is_music and music_genre) =====
${audioAnalysis}
`
    : ''
}
===== SCRIPT / TRANSCRIPT TO CLASSIFY =====
${transcript}
`
}
