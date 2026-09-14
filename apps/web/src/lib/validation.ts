/**
 * Client-side validation fallback matching the backend field names.
 * (@conex/schemas currently only ships shared kernel types, so the forms
 * validate locally: name, slug, status, billing_email, phone, notes /
 * first_name, last_name, email, phone, mobile, title, clientId, siteId,
 * is_primary.)
 */

export type FormErrors = Record<string, string | undefined>;

export function hasErrors(e: FormErrors): boolean {
	return Object.values(e).some(Boolean);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PHONE_RE = /^[+()\-.\s\d]{5,32}$/;

export function slugify(name: string): string {
	return name
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
}

export function validateClient(v: {
	name: string;
	slug: string;
	status: string;
	billing_email: string;
	phone: string;
}): FormErrors {
	const e: FormErrors = {};
	if (!v.name.trim()) e.name = "Name is required.";
	else if (v.name.trim().length < 2) e.name = "Name is too short.";
	if (v.slug.trim() && !SLUG_RE.test(v.slug.trim())) {
		e.slug = "Lowercase letters, numbers and dashes only.";
	}
	if (!["active", "onboarding", "churned"].includes(v.status)) {
		e.status = "Pick a valid status.";
	}
	if (v.billing_email.trim() && !EMAIL_RE.test(v.billing_email.trim())) {
		e.billing_email = "Enter a valid email address.";
	}
	if (v.phone.trim() && !PHONE_RE.test(v.phone.trim())) {
		e.phone = "Enter a valid phone number.";
	}
	return e;
}

export function validateSite(v: { name: string }): FormErrors {
	const e: FormErrors = {};
	if (!v.name.trim()) e.name = "Site name is required.";
	return e;
}

export function validateContact(v: {
	first_name: string;
	last_name: string;
	email: string;
	phone: string;
	mobile: string;
	clientId: string;
}): FormErrors {
	const e: FormErrors = {};
	if (!v.first_name.trim()) e.first_name = "First name is required.";
	if (!v.last_name.trim()) e.last_name = "Last name is required.";
	if (v.email.trim() && !EMAIL_RE.test(v.email.trim())) {
		e.email = "Enter a valid email address.";
	}
	if (v.phone.trim() && !PHONE_RE.test(v.phone.trim())) {
		e.phone = "Enter a valid phone number.";
	}
	if (v.mobile.trim() && !PHONE_RE.test(v.mobile.trim())) {
		e.mobile = "Enter a valid mobile number.";
	}
	if (!v.clientId) e.clientId = "Pick a client.";
	return e;
}
