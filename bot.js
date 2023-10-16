import https from 'https';
import ethers from 'ethers';
import express from 'express';
import expressWs from 'express-ws';
import fs from 'fs'
import chalk from 'chalk';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();

var options = {
  key: fs.readFileSync('server.key', 'utf-8'),
  cert: fs.readFileSync('server.crt', 'utf-8'),
};
const httpsServer = https.createServer(options, app);
const wss = expressWs(app, httpsServer);

const data = {
  WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', //wbnb 
  to_PURCHASE: '0xe9e7cea3dedca5984780bafc599bd69add087d56',  // token to purchase = BUSD for test
  factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',  //PancakeSwap V2 factory
  router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', //PancakeSwap V2 router
  recipient: '0xC23C87dF09d4552d52Df6fa1AB9F56A3B0d3296d', //wallet address,
  privateKey: '0a182b167b337fb6db2adac22d216ab30c4a3498035d29deec8857be01e9b8de',
  AMOUNT_OF_WBNB: '0.00002',
  Slippage: '3', //in Percentage
  gasPrice: '5', //in gwei
  gasLimit: '345684' //at least 21000
}

const mainnetUrl = 'https://bsc-dataseed.binance.org/'
//const mainnetUrl = 'https://kovan.infura.io/v3/425f5a1afd324cd7aee344bd02a8c2d0'
//const mainnetUrl = 'https://mainnet.infura.io/v3/5fd436e2291c47fe9b20a17372ad8057'

const provider = new ethers.providers.JsonRpcProvider(mainnetUrl)

var wallet = new ethers.Wallet(data.privateKey);
const account = wallet.connect(provider);

var botStatus = false;

function setBotStatus(obj) {
  botStatus = obj.botStatus;
  //data.recipient = obj.walletAddr;
  //data.privateKey = obj.privateKey;
  data.AMOUNT_OF_WBNB = obj.inAmount;
  data.Slippage = obj.slippage;
  data.gasPrice = obj.gasPrice;
  data.gasLimit = obj.gasLimit 
}

app.ws('/connect', function (ws, req) {
  ws.on('message', function (msg) {
    console.log(msg)
    if (msg === "connectRequest") {
      var obj = { botStatus: botStatus };
      ws.send(JSON.stringify(obj))
    } else {
      var obj = JSON.parse(msg)
      setBotStatus(obj)
      botStatus = obj.botStatus 
    }
  })
})

const router = new ethers.Contract(
  data.router,
  [
    'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
    'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
    'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)'
  ],
  account
);

const run = async () => {
  const pairCreated = new ethers.Contract(data.factory, ['event PairCreated(address indexed token0, address indexed token1, address pair, uint pairNums)'], account);
  pairCreated.on('PairCreated', async (token0Addr, token1Addr, pairAddr, pairNums) => {
    console.log('New Pair Create detected : ', token0Addr, token1Addr, pairAddr, pairNums);
    fs.appendFile('log.txt', new Date().toISOString() + ': New Pair Created ' + token0Addr + ' ' + token1Addr + ' ' + pairAddr + '\n', function (err) {
      if (err) throw err;
    });

    let pairAddress = pairAddr;

    if (pairAddress !== null && pairAddress !== undefined) {
      console.log("pairAddress.toString().indexOf('0x0000000000000')", pairAddress.toString().indexOf('0x0000000000000'));
      if (pairAddress.toString().indexOf('0x0000000000000') > -1) {
        console.log(chalk.red(`pairAddress ${pairAddress} not detected. Restart me!`));
        return;
      }
    }
    

    if (token0Addr !== data.WBNB && token1Addr !== data.WBNB) {
      return;
    }
  
    let initialLiquidityDetected = false;
    //const pair = new ethers.Contract(pairAddress, ['event Mint(address indexed sender, uint amount0, uint amount1)'], account);
    const pair = new ethers.Contract(pairAddress, ['event Sync(uint112 reserve1, uint112 reserve2)'], account);

    //pair.on('Mint', async (sender, amount0, amount1) => {
    pair.on('Sync', async (amount0, amount1) => {
      if (initialLiquidityDetected === true) {
        return;
      }

      var aWss = wss.getWss('/');
      aWss.clients.forEach(function (client) {
          var obj = {tokenA: token0Addr, tokenB: token1Addr, pair: pairAddress};
          var updateInfo = JSON.stringify(obj);
          client.send(updateInfo);
      });

      initialLiquidityDetected = true;
      const tokenIn = data.WBNB;
      const tokenOut = (token0Addr === data.WBNB) ? token1Addr : token0Addr;


      //We buy x amount of the new token for our wbnb
      const amountIn = ethers.utils.parseUnits(`${data.AMOUNT_OF_WBNB}`, 'ether');
      console.log(amountIn, data.WBNB, tokenOut)
      const amounts = await router.getAmountsOut(amountIn, [tokenIn, tokenOut]);

      //Our execution price will be a bit different, we need some flexbility
      const amountOutMin = amounts[1].sub(amounts[1].mul(`${data.Slippage}`).div(100));
      //const amountOutMin = amounts[1].sub(amounts[1].div(`${data.Slippage}`)); 
      console.log('slippage', amountOutMin, amounts[1])

      console.log(
        chalk.green.inverse(`Liquidity Addition Detected\n`)
        +
        `Buying Token
        =================
        tokenIn: ${amountIn.toString()} ${tokenIn} (WBNB)
        tokenOut: ${amountOutMin.toString()} ${tokenOut}
      `);

      console.log('Processing Transaction.....');
      console.log(chalk.yellow(`amountIn: ${amountIn}`));
      console.log(chalk.yellow(`amountOutMin: ${amountOutMin}`));
      console.log(chalk.yellow(`tokenIn: ${tokenIn}`));
      console.log(chalk.yellow(`tokenOut: ${tokenOut}`));
      console.log(chalk.yellow(`data.recipient: ${data.recipient}`));
      console.log(chalk.yellow(`data.gasLimit: ${data.gasLimit}`));
      console.log(chalk.yellow(`data.gasPrice: ${ethers.utils.parseUnits(`${data.gasPrice}`, 'gwei')}`));
      
      fs.appendFile('log.txt', new Date().toISOString() + ': Preparing to buy token ' + tokenIn + ' ' + amountIn + ' ' + tokenOut + ' ' + amountOutMin + '\n', function (err) {
        if (err) throw err;
      });
  

      if (botStatus === true) {
        const tx = await router.swapExactETHForTokens(
          amountOutMin,
          [tokenIn, tokenOut],
          data.recipient,
          Date.now() + 1000 * 60 * 10, //10 minutes
          {
            'gasLimit': data.gasLimit,
            'gasPrice': ethers.utils.parseUnits(`${data.gasPrice}`, 'gwei'),
            'value': amountIn
          }).catch((err) => {
            console.log('transaction failed...')
          });
               
        await tx.wait();
      }
    });
  })
}

run();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname, '/index.html'));
});

const PORT = 5000;

httpsServer.listen(PORT, (console.log(chalk.yellow(`Listening for new Liquidity Addition to token...`))));
