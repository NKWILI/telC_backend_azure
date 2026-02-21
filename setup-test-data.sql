-- Check if activation_codes has an 'id' column
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'activation_codes'
ORDER BY ordinal_position;

-- Check primary key / unique constraints
SELECT tc.constraint_name, tc.constraint_type, kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu 
  ON tc.constraint_name = kcu.constraint_name
WHERE tc.table_name = 'activation_codes';
