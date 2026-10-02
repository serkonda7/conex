-- Console ports became general ports: the unknown-connector kind is `port`.
UPDATE "interfaces" SET "kind" = 'port' WHERE "kind" = 'console';
--> statement-breakpoint
UPDATE "device_type_interfaces" SET "kind" = 'port' WHERE "kind" = 'console';
