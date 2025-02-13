"""Main application integrating F1 data pipeline with analysis"""
from typing import Dict, Any, Optional, List
from datetime import datetime
import logging
import pandas as pd
import json
import ast

# FastAPI and Pydantic
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Database models
from app.models.user import User, QueryHistory
from app.database import get_db, SessionLocal
from sqlalchemy.orm import Session

# Custom components
from app.query.processor import QueryProcessor
from app.pipeline.data2 import DataPipeline
from app.pipeline.optimized_adapters import OptimizedQueryAdapter, OptimizedResultAdapter
from app.analyst.generate import generate_code, execute_code_safely

# Set up logging with more detail
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request model
class QueryRequest(BaseModel):
    query: str

def validate_constructor_data(data: Any) -> List[Dict]:
    """Validate and normalize constructor data to ensure consistent format."""
    if isinstance(data, str):
        try:
            # Try to parse string as JSON first
            data = json.loads(data)
        except json.JSONDecodeError:
            try:
                # If JSON fails, try ast.literal_eval
                data = ast.literal_eval(data)
            except (ValueError, SyntaxError):
                logger.error(f"Failed to parse constructor data: {data}")
                return []
    
    if not isinstance(data, list):
        logger.error(f"Constructor data is not a list: {type(data)}")
        return []
        
    return data

def normalize_constructor_data(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize constructor data in DataFrame."""
    try:
        if 'ConstructorTable' not in df.columns:
            logger.debug("No ConstructorTable column found")
            return df
            
        logger.debug(f"ConstructorTable data types: {df['ConstructorTable'].apply(type).value_counts()}")
        
        # Validate and normalize ConstructorTable data
        df['ConstructorTable'] = df['ConstructorTable'].apply(validate_constructor_data)
        
        # Extract Ferrari's data
        df['constructor_data'] = df['ConstructorTable'].apply(
            lambda x: next((item for item in x if isinstance(item, dict) and 
                          item.get('constructorId') == 'ferrari'), {})
        )
        
        # Log the extracted Ferrari data
        logger.debug(f"Extracted Ferrari data sample: {df['constructor_data'].iloc[0] if not df.empty else None}")
        
        # Drop the original ConstructorTable column
        df = df.drop('ConstructorTable', axis=1)
        
        # Expand constructor data if not empty
        if not df.empty and df['constructor_data'].iloc[0]:
            try:
                constructor_df = pd.json_normalize(df['constructor_data'].tolist())
                logger.debug(f"Normalized constructor columns: {constructor_df.columns}")
                df = pd.concat([df.drop('constructor_data', axis=1), constructor_df], axis=1)
            except Exception as e:
                logger.error(f"Failed to normalize constructor data: {str(e)}")
                # Keep original data if normalization fails
                df = df.drop('constructor_data', axis=1)
        else:
            df = df.drop('constructor_data', axis=1)
            
        return df
    except Exception as e:
        logger.error(f"Error in normalize_constructor_data: {str(e)}")
        return df

def clean_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """Clean DataFrame by removing duplicates and invalid data."""
    logger.debug("Starting DataFrame cleaning")
    logger.debug(f"Initial shape: {df.shape}")
    
    # Remove rows where ConstructorTable is just a year number
    if 'ConstructorTable' in df.columns:
        df = df[df['ConstructorTable'].apply(lambda x: not (isinstance(x, (int, float)) or (isinstance(x, str) and x.isdigit())))]
        logger.debug(f"Shape after removing numeric ConstructorTable: {df.shape}")
    
    # Drop duplicates based on specific columns, excluding unhashable types
    safe_columns = [col for col in df.columns if col != 'ConstructorTable']
    if safe_columns:
        df = df.drop_duplicates(subset=safe_columns)
        logger.debug(f"Shape after dropping duplicates: {df.shape}")
    
    # If we have both 'year' and 'season', ensure they match and keep one
    if 'year' in df.columns and 'season' in df.columns:
        df = df[df['year'] == df['season']]
        df = df.drop('season', axis=1)
        logger.debug(f"Shape after year/season reconciliation: {df.shape}")
    
    return df

@app.post("/api/v1/analyze")
async def analyze_f1_data(request: QueryRequest) -> Dict[str, Any]:
    """
    Process F1 data analysis queries using the optimized pipeline.
    
    Args:
        request: QueryRequest containing the natural language query
        
    Returns:
        Dict containing analysis results, executed code, and processing metadata
    """
    try:
        start_time = datetime.now().timestamp()
        logger.debug(f"Starting analysis with query: {request.query}")
        
        # Step 1: Process query
        processor = QueryProcessor()
        query_result = await processor.process_query(request.query)
        logger.debug(f"Query processing result: {query_result}")
        
        # Step 2: Adapt query using optimized adapter
        query_adapter = OptimizedQueryAdapter()
        adapted_result = await query_adapter.adapt(query_result)
        logger.debug(f"Adapted query result: {adapted_result}")
        
        # Step 3: Process through optimized pipeline
        pipeline = DataPipeline()
        requirements = adapted_result.to_data_requirements()
        pipeline_response = await pipeline.process(requirements)
        logger.debug(f"Pipeline response type: {type(pipeline_response)}")
        
        # Step 4: Adapt pipeline result
        result_adapter = OptimizedResultAdapter()
        pipeline_result = await result_adapter.adapt_pipeline_result(pipeline_response, start_time)
        logger.debug(f"Pipeline result success: {pipeline_result.success}")
        
        if not pipeline_result.success or pipeline_result.data is None:
            logger.error(f"Pipeline failed: {pipeline_result.error}")
            raise HTTPException(
                status_code=400,
                detail=f"Pipeline processing failed: {pipeline_result.error or 'No data returned'}"
            )
            
        # Step 5: Generate and execute analysis code
        results = pipeline_result.data.get('results', {})
        logger.debug(f"Raw results type: {type(results)}")
        logger.debug(f"Raw results structure: {json.dumps(results, default=str)[:500]}...")
        
        try:
            # Handle different result types
            if isinstance(results, pd.DataFrame):
                logger.debug("Results is already a DataFrame")
                df = results
            elif isinstance(results, dict):
                df = pd.DataFrame([results])
            elif isinstance(results, list):
                df = pd.DataFrame(results)
            else:
                logger.error(f"Unexpected results type: {type(results)}")
                raise ValueError(f"Cannot process results of type: {type(results)}")
            
            # Clean the DataFrame before normalization
            df = clean_dataframe(df)
            logger.debug(f"DataFrame shape after cleaning: {df.shape}")
            logger.debug(f"Columns after cleaning: {list(df.columns)}")
            
            # Normalize the constructor data
            df = normalize_constructor_data(df)
            logger.debug(f"Final DataFrame shape: {df.shape}")
            logger.debug(f"Final columns: {list(df.columns)}")
            logger.debug(f"Data types: {df.dtypes}")
            
            if df.empty:
                raise HTTPException(status_code=400, detail="No data available after processing")
                
        except Exception as e:
            logger.error(f"DataFrame processing error: {str(e)}", exc_info=True)
            raise HTTPException(status_code=400, detail=f"Failed to process data: {str(e)}")
        
        # Generate and execute code with additional logging
        logger.debug("Generating analysis code")
        code = generate_code(df, request.query)
        logger.debug(f"Generated code: {code}")
        
        success, result, executed_code = execute_code_safely(code, df)
        logger.debug(f"Code execution success: {success}")
        
        if not success:
            logger.error(f"Code execution failed: {result}")
            raise HTTPException(
                status_code=400,
                detail=f"Code execution failed: {result}"
            )
            
        # Return comprehensive result
        return {
            "success": True,
            "data": result,
            "executed_code": executed_code,
            "query_trace": query_result.trace,
            "processing_time": datetime.now().timestamp() - start_time,
            "metadata": pipeline_result.metadata
        }
        
    except HTTPException as e:
        logger.error(f"HTTP Exception: {str(e)}")
        return {
            "success": False,
            "error": "Analysis failed",
            "details": e.detail,
            "processing_time": datetime.now().timestamp() - start_time
        }
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}", exc_info=True)
        return {
            "success": False,
            "error": "Analysis failed",
            "details": str(e),
            "processing_time": datetime.now().timestamp() - start_time
        }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 