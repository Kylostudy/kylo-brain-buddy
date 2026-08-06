UPDATE public.reddit_accounts SET target_subreddits = '["Switzerland","Zurich","EnglishLearning","learnenglish","IELTS","EnglishGrammar","languagelearning"]'::jsonb WHERE id='9871dbb3-4545-4ada-a242-694249d29a8f';
UPDATE public.reddit_accounts SET target_subreddits = '["singapore","EnglishLearning","learnenglish","IELTS","ToeflAdvice","EnglishGrammar","languagelearning"]'::jsonb WHERE id='48cebd9b-44fe-4399-811c-4b9e3db5848d';
UPDATE public.reddit_accounts SET target_subreddits = '["EnglishLearning","learnenglish","IELTS","CambridgeExams","EnglishGrammar","languagelearning"]'::jsonb WHERE id='f09a70a2-82df-44c4-8500-e7ba5458539f';
UPDATE public.reddit_accounts SET target_subreddits = '["newzealand","EnglishLearning","IELTS","learnenglish","EnglishGrammar","languagelearning"]'::jsonb WHERE id='659e9b48-8480-4835-8779-030cc6ef7d43';
UPDATE public.reddit_accounts SET target_subreddits = '["ireland","EnglishLearning","IELTS","learnenglish","EnglishGrammar","languagelearning"]'::jsonb WHERE id='d4333034-3a40-4a70-8c37-674e0a3bf51e';
UPDATE public.reddit_accounts SET target_subreddits = '["Netherlands","EnglishLearning","learnenglish","ToeflAdvice","EnglishGrammar","languagelearning"]'::jsonb WHERE id='8065df96-414c-4836-996b-a17fb8a7380e';
UPDATE public.reddit_accounts SET target_subreddits = '["EnglishLearning","learnenglish","ToeflAdvice","GRE","EnglishGrammar","languagelearning"]'::jsonb WHERE id='bcc29df5-6400-408b-950e-cfd097c05037';
UPDATE public.reddit_accounts SET target_subreddits = '["australia","EnglishLearning","IELTS","learnenglish","EnglishGrammar","languagelearning"]'::jsonb WHERE id='2d697ccf-7984-435e-8dc1-e670e92f235c';
UPDATE public.reddit_accounts SET target_subreddits = '["es","spain","EnglishLearning","learnenglish","CambridgeExams","languagelearning"]'::jsonb WHERE id='dac748a4-dfe9-4e33-adf5-2dab4e9cf0e9';
UPDATE public.reddit_accounts SET target_subreddits = '["hungary","askhungary","EnglishLearning","learnenglish","IELTS","languagelearning"]'::jsonb WHERE id='dc4a19e0-018e-4ae9-b927-ef1cd8246f8d';
UPDATE public.reddit_accounts SET target_subreddits = '["Polska","poland","EnglishLearning","learnenglish","CambridgeExams","languagelearning"]'::jsonb WHERE id='cbd8c2b1-3c70-4190-9f29-4e60c0114e12';
UPDATE public.reddit_accounts SET target_subreddits = '["Turkey","EnglishLearning","learnenglish","IELTS","ToeflAdvice","languagelearning"]'::jsonb WHERE id='de8e5e0f-1b68-4b04-83fd-1572536e9bd9';
UPDATE public.reddit_accounts SET target_subreddits = '["EnglishLearning","learnenglish","ToeflAdvice","IELTS","EnglishGrammar","languagelearning"]'::jsonb WHERE id='4df9e614-5daf-4e31-946b-ed6e3668c9ee';

UPDATE public.reddit_readonly_watches
SET subreddits = ARRAY['EnglishLearning','learnenglish','ENGLISH','EnglishGrammar','IELTS','ToeflAdvice','CambridgeExams','languagelearning','LearnGerman','German','learnspanish','Spanish'],
    language_label = 'english-exam'
WHERE id='d3aaea0a-4709-4b1e-91a9-bd3b8e9e1426';