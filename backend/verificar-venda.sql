SELECT
    column_name,
    data_type,
    numeric_precision,
    numeric_scale,
    character_maximum_length,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'Venda'
  AND column_name IN ('troco', 'valorRecebido', 'observacao')
ORDER BY column_name;
