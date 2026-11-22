import { createMockProvider, MOCK_API_KEY } from "./mock-provider";

const port = Number(process.env.MOCK_PROVIDER_PORT ?? 4010);
const mock = createMockProvider();
const url = await mock.listen(port);
console.log(`Mock provider listening at ${url} (API key: ${MOCK_API_KEY})`);
