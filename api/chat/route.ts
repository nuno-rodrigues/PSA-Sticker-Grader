export async function POST(req: Request) {
  const { message } = await req.json();

  const response = await fetch('https://ollama.com/api/chat', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OLLAMA_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama3.1',
      messages: [{ role: 'user', content: message }],
      stream: false // set to true if you want streaming
    })
  });

  const data = await response.json();
  return Response.json(data);
}