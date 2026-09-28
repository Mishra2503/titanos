export class NextResponse extends Response {
  static redirect(url, init = {}) {
    return new NextResponse(null, {
      status: init.status ?? 307,
      headers: { location: String(url) },
    });
  }
}
