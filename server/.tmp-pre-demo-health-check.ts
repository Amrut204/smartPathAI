import request from "supertest";
import app from "./src/app.ts";

const response = await request(app).get("/api/health/demo");
console.log(JSON.stringify({ statusCode: response.status, body: response.body }));