
const express = require("express");
const app = express();
const port = 3000;
const { OpenAIClient, AzureKeyCredential } = require("@azure/openai");
const client = new OpenAIClient(
    "https://prod-view2.openai.azure.com",
    new AzureKeyCredential("35096934eaa84d9fa4966bf837cdd516")
);
const { MongoClient } = require('mongodb');

async function main() {
    const mongoClient = new MongoClient("mongodb+srv://cosmicworksadmin:shwan%40spence5@dg3bj4g7op62fkq-mongo.mongocluster.cosmos.azure.com/?tls=true&authMechanism=SCRAM-SHA-256&retrywrites=false&maxIdleTimeMS=120000");
    const db = mongoClient.db('cosmic_works');
    const products = db.collection('products');
    const product = await products.findOne({});
    console.log(product);
}
// const chatResponse = client.getChatCompletions(
//     "gpt-4", // deployment name
//     [
//         { role: "system", content: "You are a helpful, fun and friendly sales assistant for Cosmic Works, a bicycle and bicycle accessories store." },
//         { role: "user", content: "Do you sell bicycles?" },
//         { role: "assistant", content: "Yes, we do sell bicycles. What kind of bicycle are you looking for?" },
//         { role: "user", content: "I'm not sure what I'm looking for. Could you help me decide?" }
//     ]);

// chatResponse.then((result) => {
//     for (const choice of result.choices) {
//         console.log(choice.message.content);
//     }
// }).catch((err) => console.log(err));

app.get("/", (req, res) => {
    res.send("Hello World!");
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}!`);
});

main().catch(console.error);
