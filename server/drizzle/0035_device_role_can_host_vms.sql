ALTER TABLE "device_roles" ADD COLUMN "can_host_vms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Built-in PC and Server roles host VMs by default.
UPDATE "device_roles" SET "can_host_vms" = 1 WHERE "key" IN ('pc', 'server');
