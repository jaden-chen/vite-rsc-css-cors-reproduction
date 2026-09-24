import Link from "next/link";
import Card from "./card";
export default function Page() {
  return (
    <>
      <h1>First page</h1>
      <Card />
      <p>
        <Link href="/second" target="_blank" prefetch={false}>
          Second page (new tab)
        </Link>
      </p>
      <p>
        <a href="/third">Third page (same tab)</a>
      </p>
    </>
  );
}
