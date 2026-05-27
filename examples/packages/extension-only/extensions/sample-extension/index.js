export default function sampleExtension(otto) {
  otto.registerCommand?.("sample-extension", {
    description: "Verify that the sample extension package loaded.",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Sample extension package is installed.", "info");
    },
  });
}

