export default function mixedSampleExtension(otto) {
  otto.registerCommand?.("mixed-sample", {
    description: "Verify that the mixed sample package loaded.",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Mixed sample package extension is installed.", "info");
    },
  });
}

