import { load } from "cheerio";

export interface FetchResult {
  url: string;
  html: string;
  markdown: string;
  status: number;
  parserUsed: string;
}

function htmlToMarkdownLikeText(html: string): string {
  const $ = load(html);
  $("script, style, noscript").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

export async function fetchPage(url: string): Promise<FetchResult> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  const html = await response.text();

  return {
    url: response.url,
    html,
    markdown: htmlToMarkdownLikeText(html),
    status: response.status,
    parserUsed: "http-fetch"
  };
}
