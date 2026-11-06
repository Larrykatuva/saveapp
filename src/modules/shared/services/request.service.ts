import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Agent, AgentOptions } from 'https';
import { catchError, lastValueFrom } from 'rxjs';
import qs from 'qs';
import { AxiosError, AxiosRequestHeaders } from 'axios';
import FormData from 'form-data';
import { HttpService } from '@nestjs/axios';
import * as fs from 'fs';

// Enum for setting different request content types
export enum RequestContentType {
  FORM_URLENCODED = 'application/x-www-form-urlencoded',
  FORM_DATA = 'multipart/form-data',
  JSON = 'application/json',
}

@Injectable()
export class RequestService {
  // Default content type is JSON
  private contentType: RequestContentType;

  constructor(public httpService: HttpService) {
    this.contentType = RequestContentType.JSON; // Initialize with default JSON content type
  }

  /**
   * Set the request content type based on input. If invalid, defaults to JSON.
   * @param contentType - The content type for the request.
   */
  setContentType(contentType: string): void {
    switch (contentType) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      case RequestContentType.FORM_DATA:
        this.contentType = RequestContentType.FORM_DATA;
        break;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      case RequestContentType.FORM_URLENCODED:
        this.contentType = RequestContentType.FORM_URLENCODED;
        break;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      case RequestContentType.JSON:
        this.contentType = RequestContentType.JSON;
        break;
      default:
        // Throws an error if the provided content type is not valid
        throw new HttpException(
          'Invalid request content type',
          HttpStatus.BAD_REQUEST,
        );
    }
  }

  /**
   * Prepare the request body depending on the set content type.
   * This is used to format the data before sending it in the request.
   * @param payload - The data to be sent in the request body.
   * @private
   */
  private prepareRequestBody(payload: object): any {
    switch (this.contentType) {
      case RequestContentType.JSON:
        return payload; // No transformation for JSON
      case RequestContentType.FORM_URLENCODED:
        return qs.stringify(payload); // Format data as x-www-form-urlencoded
      case RequestContentType.FORM_DATA: {
        const data = new FormData();
        const keys: string[] = Object.keys(payload);
        for (let i: number = 0; i < keys.length; i++) {
          // If the payload contains a file, append it as a stream
          if (payload[keys[i]].path) {
            data.append(keys[i], fs.createReadStream(payload[keys[i]].path));
          } else {
            data.append(keys[i], payload[keys[i]]);
          }
        }
        return data; // Return formatted FormData
      }
      default:
        break;
    }
  }

  /**
   * Handle PATCH requests. Sends the payload to the given URL with headers and handles errors.
   * @param url - The URL for the PATCH request.
   * @param payload - The data to be sent in the PATCH request body.
   * @param contentType - The content type for the request (defaults to JSON).
   * @param token - Bearer token for authorization (optional).
   * @param headers - Additional headers for the request (optional).
   */
  async patchRequest<P, R>(
    url: string,
    payload: P,
    contentType: string = RequestContentType.JSON,
    token?: string,
    headers?: AxiosRequestHeaders,
  ): Promise<{ status: number; data: R }> {
    // Log request start time
    const startTime: number = Date.now();
    this.setContentType(contentType); // Set content type for the request
    const httpsAgent: AgentOptions = new Agent({ rejectUnauthorized: false }); // Disable SSL verification
    const { status, data } = await lastValueFrom(
      this.httpService
        .patch<R>(url, this.prepareRequestBody(payload as object), {
          headers: {
            Authorization: token ? `Bearer ${token}` : '', // Add Authorization header if token is present
            'Content-Type': this.contentType || RequestContentType.JSON, // Use the set content type
            ...headers, // Merge any additional headers
          },
          httpsAgent, // Add custom agent for SSL handling
        })
        .pipe(
          catchError((error: AxiosError) => {
            // Analyze failed request response time
            this.analyzeRequest(
              startTime,
              url,
              error.status as unknown as number,
            );
            // Catch errors, and throw an exception with the error message
            throw new HttpException(
              error.response
                ? (error?.response.data as string)
                : 'An error occurred while making the request',
              HttpStatus.BAD_REQUEST,
            );
          }),
        ),
    );
    // Analyze successful request response time
    this.analyzeRequest(startTime, url, status);
    return { status, data }; // Return the response status and data
  }

  /**
   * Handle DELETE requests. Sends a DELETE request to the given URL with headers and handles errors.
   * @param url - The URL for the DELETE request.
   * @param token - Bearer token for authorization (optional).
   * @param headers - Additional headers for the request (optional).
   */
  async deleteRequest<R>(
    url: string,
    token?: string,
    headers?: AxiosRequestHeaders,
  ): Promise<{ data: R } | void> {
    // Log request start time
    const startTime: number = Date.now();
    const httpsAgent: AgentOptions = new Agent({ rejectUnauthorized: false }); // Disable SSL verification
    const { data } = await lastValueFrom(
      this.httpService
        .delete<{ data: R } | void>(url, {
          headers: {
            Authorization: token ? `Bearer ${token}` : '', // Add Authorization header if token is present
            'Content-Type': this.contentType || RequestContentType.JSON, // Use the set content type
            ...headers, // Merge any additional headers
          },
          httpsAgent, // Add custom agent for SSL handling
        })
        .pipe(
          catchError((error: AxiosError) => {
            // Analyze failed request response time
            this.analyzeRequest(
              startTime,
              url,
              error.status as unknown as number,
            );
            // Catch errors, and throw an exception with the error message
            throw new HttpException(
              error.response
                ? (error?.response.data as string)
                : 'An error occurred while making the request',
              HttpStatus.BAD_REQUEST,
            );
          }),
        ),
    );
    return data;
  }

  /**
   * Handle PUT requests. Sends the payload to the given URL with headers and handles errors.
   * @param url - The URL for the PUT request.
   * @param payload - The data to be sent in the PUT request body.
   * @param contentType - The content type for the request (defaults to JSON).
   * @param token - Bearer token for authorization (optional).
   * @param headers - Additional headers for the request (optional).
   */
  async putRequest<P, R>(
    url: string,
    payload: P,
    contentType: string = RequestContentType.JSON,
    token?: string,
    headers?: AxiosRequestHeaders,
  ): Promise<{ status: number; data: R }> {
    // Log request start time
    const startTime: number = Date.now();
    this.setContentType(contentType); // Set content type for the request
    const httpsAgent: AgentOptions = new Agent({ rejectUnauthorized: false }); // Disable SSL verification
    const { status, data } = await lastValueFrom(
      this.httpService
        .put<R>(url, this.prepareRequestBody(payload as object), {
          headers: {
            Authorization: token ? `Bearer ${token}` : '', // Add Authorization header if token is present
            'Content-Type': this.contentType || RequestContentType.JSON, // Use the set content type
            ...headers, // Merge any additional headers
          },
          httpsAgent, // Add custom agent for SSL handling
        })
        .pipe(
          catchError((error: AxiosError) => {
            // Analyze failed request response time
            this.analyzeRequest(
              startTime,
              url,
              error.status as unknown as number,
            );
            // Catch errors, and throw an exception with the error message
            throw new HttpException(
              error.response
                ? (error?.response.data as string)
                : 'An error occurred while making the request',
              HttpStatus.BAD_REQUEST,
            );
          }),
        ),
    );
    // Analyze successful request response time
    this.analyzeRequest(startTime, url, status);
    return { status, data }; // Return the response status and data
  }

  /**
   * Handle POST requests. Sends the payload to the given URL with headers and handles errors.
   * @param url - The URL for the POST request.
   * @param payload - The data to be sent in the POST request body.
   * @param contentType - The content type for the request (defaults to JSON).
   * @param token - Bearer token for authorization (optional).
   * @param headers - Additional headers for the request (optional).
   */
  async postRequest<P, R>(
    url: string,
    payload: P,
    contentType: string = RequestContentType.JSON,
    token?: string,
    headers?: AxiosRequestHeaders,
  ): Promise<{ status: number; data: R }> {
    // Log request start time
    const startTime: number = Date.now();
    this.setContentType(contentType); // Set content type for the request
    const httpsAgent: AgentOptions = new Agent({ rejectUnauthorized: false }); // Disable SSL verification
    const { status, data } = await lastValueFrom(
      this.httpService
        .post<R>(url, this.prepareRequestBody(payload as object), {
          timeout: 60000, // Set a timeout of 60 seconds for the request
          headers: {
            Authorization: token ? `Bearer ${token}` : '', // Add Authorization header if token is present
            'Content-Type': this.contentType || RequestContentType.JSON, // Use the set content type
            ...headers, // Merge any additional headers
          },
          httpsAgent, // Add custom agent for SSL handling
        })
        .pipe(
          catchError((error: AxiosError) => {
            this.analyzeRequest(
              startTime,
              url,
              error.status as unknown as number,
            );
            // Catch errors, and throw an exception with the error message
            throw new HttpException(
              error.response
                ? (error?.response.data as string)
                : 'An error occurred while making the request',
              HttpStatus.BAD_REQUEST,
            );
          }),
        ),
    );
    // Analyze successful request response time
    this.analyzeRequest(startTime, url, status);
    return { status, data }; // Return the response status and data
  }

  /**
   * Handle GET requests. Sends a GET request to the given URL with headers and handles errors.
   * @param url - The URL for the GET request.
   * @param token - Bearer token for authorization (optional).
   * @param headers - Additional headers for the request (optional).
   */
  async getRequest<R>(
    url: string,
    token?: string,
    headers?: AxiosRequestHeaders,
  ): Promise<{ status: number; data: R }> {
    // Log request start time
    const startTime: number = Date.now();
    const httpsAgent: AgentOptions = new Agent({ rejectUnauthorized: false }); // Disable SSL verification
    const { status, data } = await lastValueFrom(
      this.httpService
        .get<R>(url, {
          timeout: 60000, // Set a timeout of 60 seconds for the request
          headers: {
            Authorization: token ? `Bearer ${token}` : '', // Add Authorization header if token is present
            'Content-Type': RequestContentType.JSON, // Default content type is JSON for GET requests
            ...headers, // Merge any additional headers
          },
          httpsAgent, // Add custom agent for SSL handling
        })
        .pipe(
          catchError((error: AxiosError) => {
            // Analyze failed request response time
            this.analyzeRequest(
              startTime,
              url,
              error.status as unknown as number,
            );
            // Catch errors, and throw an exception with the error message
            throw new HttpException(
              error.response
                ? (error?.response.data as string)
                : 'An error occurred while making the request',
              HttpStatus.BAD_REQUEST,
            );
          }),
        ),
    );
    // Analyze successful request response time
    this.analyzeRequest(startTime, url, status);
    return { status, data }; // Return the response status and data
  }

  analyzeRequest(startTime: number, url: string, status: number): void {
    const timeInSec: number = (Date.now() - startTime) / 1000;
    console.log(
      `URL: ${url} - STATUS: ${status} - RESPONSE TIME: ${timeInSec} (Sec)`,
    );
  }
}
