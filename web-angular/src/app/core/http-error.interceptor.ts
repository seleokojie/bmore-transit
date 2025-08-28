import { HttpInterceptorFn, HttpRequest, HttpHandlerFn } from '@angular/common/http';

export const httpErrorInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn) => next(req);
