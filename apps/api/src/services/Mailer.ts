import { Context, Effect, Layer } from "effect"

export class Mailer extends Context.Service<
  Mailer,
  {
    readonly sendMagicLink: (options: {
      readonly email: string
      readonly token: string
      readonly consumeUrl: string
    }) => Effect.Effect<void>
  }
>()("rehydra/services/Mailer") {
  /** Logs the magic link to the console. Suitable for local development. */
  static readonly console = Layer.succeed(Mailer, {
    sendMagicLink: Effect.fn("Mailer.sendMagicLink")(function*(options: {
      readonly email: string
      readonly token: string
      readonly consumeUrl: string
    }) {
      yield* Effect.logInfo("magic link email (console)", {
        to: options.email,
        consumeUrl: options.consumeUrl,
        token: options.token,
        hint: `POST /v1/auth/magic-link/consume with { "token": "<token>" }`
      })
    })
  })
}
