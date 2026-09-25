-- NetBox imports used to store console/power connector types (de-9,
-- iec-60320-c14, ...) as the port kind. Normalize them to `console` /
-- `power` so the device page lists them under "other ports". USB types are
-- valid for both classes; the port name decides (power-ish names -> power).
UPDATE `device_type_interfaces` SET `kind` = CASE
	WHEN `kind` LIKE 'usb-%' AND (lower(`prefix`) LIKE '%power%' OR lower(`prefix`) LIKE '%psu%' OR lower(`prefix`) LIKE '%pwr%' OR lower(`prefix`) LIKE '%input%' OR lower(`prefix`) LIKE 'dc%') THEN 'power'
	WHEN `kind` LIKE 'usb-%' THEN 'console'
	WHEN `kind` IN ('de-9', 'db-25', 'rj-11', 'rj-12', 'rj-45', 'mini-din-8') THEN 'console'
	ELSE 'power'
END
WHERE `kind` LIKE 'usb-%'
	OR `kind` IN ('de-9', 'db-25', 'rj-11', 'rj-12', 'rj-45', 'mini-din-8')
	OR `kind` LIKE 'iec-60320-%' OR `kind` LIKE 'iec-60309-%' OR `kind` LIKE 'nema-%'
	OR `kind` LIKE 'cs%' OR `kind` LIKE 'ita-%' OR `kind` LIKE 'neutrik-powercon-%'
	OR `kind` LIKE 'molex-micro-fit-%'
	OR `kind` IN ('dc-terminal', 'saf-d-grid', 'hardwired');
--> statement-breakpoint
UPDATE `interfaces` SET `kind` = CASE
	WHEN `kind` LIKE 'usb-%' AND (lower(`name`) LIKE '%power%' OR lower(`name`) LIKE '%psu%' OR lower(`name`) LIKE '%pwr%' OR lower(`name`) LIKE '%input%' OR lower(`name`) LIKE 'dc%') THEN 'power'
	WHEN `kind` LIKE 'usb-%' THEN 'console'
	WHEN `kind` IN ('de-9', 'db-25', 'rj-11', 'rj-12', 'rj-45', 'mini-din-8') THEN 'console'
	ELSE 'power'
END
WHERE `kind` LIKE 'usb-%'
	OR `kind` IN ('de-9', 'db-25', 'rj-11', 'rj-12', 'rj-45', 'mini-din-8')
	OR `kind` LIKE 'iec-60320-%' OR `kind` LIKE 'iec-60309-%' OR `kind` LIKE 'nema-%'
	OR `kind` LIKE 'cs%' OR `kind` LIKE 'ita-%' OR `kind` LIKE 'neutrik-powercon-%'
	OR `kind` LIKE 'molex-micro-fit-%'
	OR `kind` IN ('dc-terminal', 'saf-d-grid', 'hardwired');
