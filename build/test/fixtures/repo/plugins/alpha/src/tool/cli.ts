import { greet } from "../core/greet.ts";

console.log(greet(process.argv[2] ?? "cli"));
