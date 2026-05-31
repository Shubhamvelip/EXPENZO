import logging
from repositories.supabase_client import supabase

logger = logging.getLogger("project_repository")


class ProjectRepository:
    """
    Data Access Layer for Expenzo Projects.
    All reads and writes go directly to Supabase.
    """

    @classmethod
    def get_project_budget(cls, project_id: str) -> float:
        """
        Fetches the total_budget for a given project_id from Supabase.
        Defaults to 1000.0 if not found.
        """
        logger.info(f"Fetching budget for project_id: '{project_id}'")
        response = supabase.table("projects") \
            .select("total_budget") \
            .eq("id", project_id) \
            .single() \
            .execute()

        if response.data:
            return float(response.data.get("total_budget", 1000.0))

        # Fallback: try matching by name-based slug
        response2 = supabase.table("projects") \
            .select("total_budget") \
            .ilike("name", project_id.replace("_", " ")) \
            .limit(1) \
            .execute()

        if response2.data:
            return float(response2.data[0].get("total_budget", 1000.0))

        logger.warning(f"Project '{project_id}' not found in Supabase. Defaulting to budget 1000.0.")
        return 1000.0

    @classmethod
    def create_project(cls, name: str, total_budget: float) -> dict:
        """
        Inserts a new project row into the Supabase `projects` table
        containing only the 'name' and 'total_budget' fields.

        Args:
            name: The display name of the project.
            total_budget: The total budget allocated to the project.

        Returns:
            A dictionary representing the newly created project record.

        Raises:
            RuntimeError: On any database connection anomaly or empty response.
        """
        payload = {
            "name": name,
            "total_budget": float(total_budget),
        }

        logger.info(f"Inserting project into 'projects' table: {payload}")
        try:
            response = supabase.table("projects").insert(payload).execute()
            if not response.data:
                logger.error(f"Supabase insert returned no data: {response}")
                raise RuntimeError("Supabase insert returned no data for the 'projects' table.")
            created: dict = response.data[0]
            logger.info(f"Successfully created project record: {created}")
            return created
        except RuntimeError:
            raise
        except Exception as e:
            logger.error(f"Database connection anomaly during project creation: {e}", exc_info=True)
            raise RuntimeError(f"Database error during project creation: {str(e)}")


    @classmethod
    def get_all_projects(cls) -> list:
        """
        Returns all registered projects from Supabase.
        """
        response = supabase.table("projects") \
            .select("*") \
            .order("created_at", desc=True) \
            .execute()

        return response.data or []
