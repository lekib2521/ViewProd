import { Injectable } from '@angular/core';
import { HttpClient, HttpParams, HttpHeaders } from '@angular/common/http';

@Injectable({
  providedIn: 'root'
})
export class PromptService {

  constructor(private http: HttpClient) { }

  start(prodInput: any){
    const options = { params: new HttpParams()
      .set('customer', prodInput.customer)
      .set('pain',prodInput.pain) 
      .set('stage', prodInput.stage)
    };
    return this.http.get<any>('http://localhost:3000/', options)
  }

  assess(prod:any,prodParam:any){
    const options = { params: new HttpParams()
      .set('name', prod.product_name)
      .set('pain',prodParam.pain) 
      .set('description', prod.description)
      .set('stage', prodParam.stage)
      .set('features', prod.features)
    };
    return this.http.get<any>('http://localhost:3000/', options)
  }
}
