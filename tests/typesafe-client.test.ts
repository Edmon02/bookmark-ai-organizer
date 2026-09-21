import { evaluateSystemOne } from '../src/utils/typesafe-client';

describe('TypeSafe client', () => {
    let fetchMock: jest.Mock;

    beforeEach(() => {
        fetchMock = jest.fn();
        (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    });

    test('retries 429 responses then returns answers', async () => {
        fetchMock
            .mockResolvedValueOnce(new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                model: 'jev-1.13.0',
                answers: {
                    keep: { type: 'noul', noul: 0.2 },
                },
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

        const result = await evaluateSystemOne('apikey_test_123456', {
            state: { title: 'Example' },
            questions: {
                keep: { type: 'noul', instructions: 'Already in a good folder?' },
            },
        });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(result.answers.keep).toEqual({ type: 'noul', noul: 0.2 });
        expect(String(fetchMock.mock.calls[0][0])).toContain('api.typesafe.ai');
    });

    test('does not retry invalid API keys', async () => {
        fetchMock.mockResolvedValue(new Response('nope', { status: 401 }));
        await expect(evaluateSystemOne('bad-key-123456', {
            state: 'hello',
            questions: { keep: { type: 'noul', instructions: 'Already in a good folder?' } },
        })).rejects.toThrow('Invalid TypeSafe API key');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
