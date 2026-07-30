export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, runtime: "workerd" });
    }
    return new Response("not found", { status: 404 });
  },
};
