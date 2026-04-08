
document.addEventListener("DOMContentLoaded", async () => {
  console.log("hello from ts in fs bridge demo, writing a file");

  await fetch("/write-test-file", {
    method: "POST",
  });
});
