ALTER TABLE external_products ADD COLUMN package_description TEXT;

UPDATE external_products
SET package_description = CASE
  WHEN package_quantity IS NOT NULL AND package_unit IS NOT NULL THEN
    RTRIM(RTRIM(PRINTF('%.3f', package_quantity), '0'), '.') || ' ' || package_unit
  WHEN package_unit IS NOT NULL THEN package_unit
  ELSE NULL
END;
