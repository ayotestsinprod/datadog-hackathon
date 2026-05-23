import Head from "next/head";

export default function Home() {
  return (
    <>
      <Head>
        <title>Pulse — Product Impression Tracker</title>
        <meta
          name="description"
          content="Monitor public sentiment around technical products over time, correlating feedback with release history on a scrubbable timeline."
        />
      </Head>
      <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-6 text-zinc-100">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 font-mono text-xs uppercase tracking-widest text-zinc-400">
            Scaffold · v0.1
          </span>
          <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">
            Pulse
          </h1>
          <p className="max-w-md text-base leading-relaxed text-zinc-400">
            Product impression tracker. Sentiment, releases, and the moments
            they intersect.
          </p>
        </div>
      </main>
    </>
  );
}
