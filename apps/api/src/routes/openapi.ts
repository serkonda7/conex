import { Hono } from "hono";

/**
 * Minimal machine-readable endpoint catalogue.
 * Full @hono/zod-openapi-style codegen is out of scope for the MVP;
 * the @openapi docblocks on each router are the source of truth.
 */
export const openapi = new Hono();

const doc = {
  openapi: "3.0.3",
  info: { title: "conex-api", version: "0.0.0" },
  paths: {
    "/api/v1/clients": {
      get: {
        summary: "List clients (keyset: ?limit=&cursor=&q=)",
        responses: { "200": { description: "Paginated clients" } },
      },
      post: {
        summary: "Create client",
        responses: {
          "201": { description: "Created" },
          "400": { description: "Validation failed" },
          "409": { description: "Name/slug conflict" },
        },
      },
    },
    "/api/v1/clients/{id}": {
      get: { summary: "Get client", responses: { "200": {}, "404": {} } },
      patch: {
        summary: "Update client",
        responses: { "200": {}, "400": {}, "404": {}, "409": {} },
      },
      delete: {
        summary: "Delete client (cascades sites + contacts)",
        responses: { "200": {}, "404": {} },
      },
    },
    "/api/v1/clients/{id}/sites": {
      get: { summary: "List client sites", responses: { "200": {} } },
      post: {
        summary: "Create site",
        responses: { "201": {}, "400": {}, "404": {} },
      },
    },
    "/api/v1/clients/{id}/sites/{siteId}": {
      patch: { summary: "Update site", responses: { "200": {}, "404": {} } },
      delete: {
        summary: "Delete site (contacts detach)",
        responses: { "200": {}, "404": {} },
      },
    },
    "/api/v1/clients/{id}/contacts": {
      get: {
        summary: "List client contacts (keyset: ?limit=&cursor=&q=)",
        responses: { "200": {} },
      },
      post: {
        summary: "Create contact for client",
        responses: { "201": {}, "400": {}, "404": {} },
      },
    },
    "/api/v1/contacts": {
      get: {
        summary: "List contacts (?clientId=&siteId=&q=&limit=&cursor=)",
        responses: { "200": {} },
      },
    },
    "/api/v1/contacts/{id}": {
      get: { summary: "Get contact", responses: { "200": {}, "404": {} } },
      patch: {
        summary: "Update contact",
        responses: { "200": {}, "400": {}, "404": {} },
      },
      delete: {
        summary: "Delete contact",
        responses: { "200": {}, "404": {} },
      },
    },
    "/api/v1/contacts/{id}/assign": {
      post: {
        summary: "Assign contact to client/site { siteId | clientId }",
        responses: { "200": {}, "400": {}, "404": {} },
      },
    },
  },
};

openapi.get("/openapi.json", (c) => c.json(doc));
