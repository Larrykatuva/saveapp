import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Request, Response } from 'express';

/** Thrown by view guards to send the browser elsewhere (e.g. to sign in). */
export class RedirectException extends Error {
  constructor(public readonly url: string) {
    super(`Redirect to ${url}`);
  }
}

@Catch(RedirectException)
export class RedirectFilter implements ExceptionFilter {
  catch(exception: RedirectException, host: ArgumentsHost) {
    const req = host.switchToHttp().getRequest<Request>();
    const res = host.switchToHttp().getResponse<Response>();
    // Fragments and ajax posts can't follow a redirect into a page
    if (req.get('x-requested-with') === 'fetch')
      return res.status(401).json({
        ok: false,
        message: 'Your session expired. Reload the page and sign in again.',
      });
    res.redirect(303, exception.url);
  }
}

/** Thrown when a signed-in account lacks the permission a page needs. */
export class ForbiddenPageException extends Error {
  constructor(public readonly homePath: string) {
    super('Forbidden');
  }
}

@Catch(ForbiddenPageException)
export class ForbiddenPageFilter implements ExceptionFilter {
  catch(exception: ForbiddenPageException, host: ArgumentsHost) {
    const req = host.switchToHttp().getRequest<Request>();
    const res = host.switchToHttp().getResponse<Response>();
    const wantsJson =
      req.get('x-requested-with') === 'fetch' ||
      (req.get('accept') ?? '').includes('application/json');
    if (wantsJson)
      return res.status(403).json({
        ok: false,
        message: "You don't have permission to do that",
      });
    res.status(403).render('pages/errors/forbidden', {
      layout: 'layouts/main',
      title: 'No access',
      homePath: exception.homePath,
    });
  }
}
