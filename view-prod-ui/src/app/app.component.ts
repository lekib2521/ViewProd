import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Title } from "@angular/platform-browser";
import { FormsModule } from '@angular/forms'
import { CommonModule } from '@angular/common';
import { PromptService } from './prompt.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, FormsModule, CommonModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  constructor(private titleService: Title, private promptService: PromptService) {
    this.titleService.setTitle("ViewProd");
  }
  title = 'view-prod-ui';
  prodParam: any = {customer:'architect', pain:'a product that helps me design buildings better'};
  currentStage: number = 1;
  breadcrumbs: any = [{ stage: 1, name: 'Start' }, { stage: 2, name: 'Feature Relevance' },]
  suggestedProducts: any = [{name:'Product Name',description:'Product Description'},{name:'Product Name',description:'Product Description'},{name:'Product Name',description:'Product Description'}]
  showProds: boolean = false;
  fetchingProds: boolean = false;
  showfeat: boolean = false;
  fetchingFeat: boolean = false;
  featureData: any = [];
  tableHeader:any = ['Feature','Customer Desirability','Technical Feasibility','Financial Viability','Overall Relevance Score'];
  
  FetchProdDetails(){
    console.log(this.prodParam);
    this.showfeat = false;
    this.showProds = false;
    this.fetchingProds = true;
    this.prodParam.stage = 1;
    this.promptService.start(this.prodParam).subscribe((data: any) => {
      if(data.length>3){
        this.suggestedProducts = data.slice(0,3);
      } else {
        this.suggestedProducts = data;
      }
      this.showProds = true;
      this.fetchingProds = false;
    });
  }

  assessFeature(prod: any){
    this.showProds = false;
    this.fetchingFeat = true;
    this.currentStage=2;
    this.prodParam.stage = this.currentStage;
    console.log(prod);
    this.promptService.assess(prod,this.prodParam).subscribe((data: any) => {
      console.log(data);
      data.map((d:any) => {
        d.overall_relevance = Math.round((d.desirability + d.viability + d.feasibility)/3);
      });
      this.featureData = data;
      this.fetchingFeat = false;
      this.showfeat = true;
    });
  }
}
